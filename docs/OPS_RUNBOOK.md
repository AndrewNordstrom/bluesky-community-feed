# Operations Runbook

This runbook covers day-2 operations for the production Bluesky feed stack.
It is written for the current VPS deployment model and can be adapted for other hosts.

## Scope

- Service lifecycle and deploy procedure
- Health checks and smoke tests
- Backup/retention and disk management
- Alerting and incident response

## Production Topology

- App service: `bluesky-feed.service` (systemd)
- App directory: `/opt/bluesky-feed`
- Backend runtime: `node dist/index.js`
- Redis + PostgreSQL: Docker Compose (`docker-compose.prod.yml`)
- PostgreSQL container: `bluesky-feed-postgres` on `127.0.0.1:5433`
- Redis container: `bluesky-feed-redis` on `127.0.0.1:6380`

## Primary Commands

```bash
# Service status and logs
sudo systemctl status bluesky-feed --no-pager
sudo journalctl -u bluesky-feed -n 200 --no-pager
sudo journalctl -u bluesky-feed -f

# Infra containers
cd /opt/bluesky-feed
docker compose -f docker-compose.prod.yml ps

# Disk and memory quick checks
df -h /
free -h
```

## Standard Deploy (main branch)

```bash
cd /opt/bluesky-feed
git fetch origin
git checkout main
git pull --ff-only origin main
npm install --no-audit --no-fund
npm run build
npm run migrate
sudo systemctl restart bluesky-feed
sudo systemctl is-active bluesky-feed
```

## Post-Rename or Transfer Validation (Manual Dispatch)

Use this after a repository rename or ownership transfer and for recurring manual verification.
This project intentionally uses a deploy-only model for ongoing checks (no extra scheduled smoke workflow).

Set the repo target once:

```bash
set -euo pipefail
command -v gh >/dev/null
command -v jq >/dev/null
command -v ssh >/dev/null
REPO="andrewnordstrom-eng/corgi"
```

Do not continue until all of these checks pass:

```bash
EXPECTED_REPO_URL="https://github.com/andrewnordstrom-eng/corgi"
EXPECTED_REMOTE_URL="${EXPECTED_REPO_URL}.git"
test "$(gh repo view "$REPO" --json url --jq .url)" = "$EXPECTED_REPO_URL"
test "$(git remote get-url origin)" = "$EXPECTED_REMOTE_URL"
test "$(ssh corgi-vps 'cd /opt/bluesky-feed && git remote get-url origin')" = "$EXPECTED_REMOTE_URL"
test "$(ssh corgi-vps 'cd /opt/bluesky-feed && git branch --show-current')" = "main"
```

The repository must resolve at the canonical name, both remotes must point
directly to it, and the VPS checkout must report `main`. Confirm the org
control-plane repository mapping separately before dispatching deploys.

### 1) Verify required repository secrets

```bash
REQUIRED_SECRETS=(
  VPS_HOST
  VPS_USER
  VPS_SSH_KEY
  VPS_SSH_HOST_KEY
  DATABASE_URL
  EXPORT_ANONYMIZATION_SALT
)
AVAILABLE_SECRET_NAMES="$(gh secret list --repo "$REPO" --json name --jq '.[].name')"
for secret_name in "${REQUIRED_SECRETS[@]}"; do
  case $'\n'"$AVAILABLE_SECRET_NAMES"$'\n' in
    *$'\n'"$secret_name"$'\n'*) ;;
    *) printf 'Missing required repository secret: %s\n' "$secret_name" >&2; exit 1 ;;
  esac
done
```

Expected required names:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_SSH_HOST_KEY` (required by `Daily Health Check`; `Deploy Docs` and
  `Weekly Research Export` use it when present, while `Deploy to VPS` currently
  delegates SSH setup to its pinned SSH action)
- `DATABASE_URL`
- `EXPORT_ANONYMIZATION_SALT`
- `HEALTHCHECK_PING_URL` (optional)

### 2) Verify CI before and after merge

```bash
# CI has pull_request and push triggers, not workflow_dispatch. Before merge,
# replace this value and require the CI run for the cutover PR's exact head.
find_ci_run() {
  local event="$1"
  local sha="$2"
  local deadline=$((SECONDS + CI_LOOKUP_TIMEOUT_SECONDS))
  local delay=5
  local run_id=""
  while (( SECONDS < deadline )); do
    run_id="$(gh run list --repo "$REPO" --workflow "CI" --event "$event" --limit 50 --json databaseId,headSha | jq -r --arg sha "$sha" '[.[] | select(.headSha == $sha)][0].databaseId // empty')"
    if [ -n "$run_id" ]; then
      printf '%s' "$run_id"
      return 0
    fi
    sleep "$delay"
    delay=$((delay < 20 ? delay * 2 : 20))
  done
  printf 'Timed out waiting for CI run with head SHA %s\n' "$sha" >&2
  return 1
}

CI_LOOKUP_TIMEOUT_SECONDS=180
CUTOVER_PR_NUMBER="<cutover-pr-number>"
PR_HEAD_SHA="$(gh pr view "$CUTOVER_PR_NUMBER" --repo "$REPO" --json headRefOid --jq .headRefOid)"
PR_CI_RUN_ID="$(find_ci_run pull_request "$PR_HEAD_SHA")"
test -n "$PR_CI_RUN_ID"
gh run watch "$PR_CI_RUN_ID" --repo "$REPO" --exit-status

# After merge, require the push-triggered CI run for the exact main commit.
MAIN_SHA="$(gh api "repos/$REPO/commits/main" --jq .sha)"
CI_RUN_ID="$(find_ci_run push "$MAIN_SHA")"
test -n "$CI_RUN_ID"
gh run watch "$CI_RUN_ID" --repo "$REPO" --exit-status
```

### 3) Trigger and watch deploy and operational workflows on `main`

This exact-run receipt requires GitHub CLI 2.87.0 or newer. It must return the
created workflow-run URL; the procedure aborts rather than guessing when no
deterministic run ID is available.

```bash
require_workflow_run_url_gh_version() {
  local version
  local version_core
  local major
  local minor
  local patch

  version="$(gh --version | awk 'NR == 1 { print $3 }')"
  version_core="${version%%-*}"
  IFS=. read -r major minor patch <<< "$version_core"
  case "$major:$minor:$patch" in
    *[!0-9:]*|:*|*::*|*:) printf 'Unable to parse GitHub CLI version: %s\n' "$version" >&2; return 1 ;;
  esac
  if (( major < 2 || (major == 2 && minor < 87) )); then
    printf 'GitHub CLI 2.87.0 or newer is required; found %s\n' "$version" >&2
    return 1
  fi
}

dispatch_and_watch() {
  local workflow="$1"
  local expected_sha="$2"
  local run_url
  local run_id
  local run_sha

  require_workflow_run_url_gh_version
  run_sha="$(gh api "repos/$REPO/commits/main" --jq .sha)"
  if [ "$run_sha" != "$expected_sha" ]; then
    printf 'Refusing to dispatch %s: main moved from %s to %s\n' "$workflow" "$expected_sha" "$run_sha" >&2
    return 1
  fi

  run_url="$(gh workflow run "$workflow" --repo "$REPO" --ref main)"
  if [ -z "$run_url" ]; then
    printf 'No deterministic run URL returned for %s; aborting\n' "$workflow" >&2
    return 1
  fi
  run_id="${run_url##*/}"
  case "$run_id" in
    ''|*[!0-9]*) printf 'Unexpected workflow dispatch response: %s\n' "$run_url" >&2; return 1 ;;
  esac
  run_sha="$(gh run view "$run_id" --repo "$REPO" --json headSha --jq .headSha)"
  if [ "$run_sha" != "$expected_sha" ]; then
    printf 'Refusing workflow run %s: expected head SHA %s, got %s\n' "$run_id" "$expected_sha" "$run_sha" >&2
    return 1
  fi
  gh run watch "$run_id" --repo "$REPO" --exit-status
}

dispatch_and_watch "Deploy Docs" "$MAIN_SHA"
dispatch_and_watch "Deploy to VPS" "$MAIN_SHA"
dispatch_and_watch "Daily Health Check" "$MAIN_SHA"
dispatch_and_watch "Weekly Research Export" "$MAIN_SHA"
```

Expected pass criteria:
- Each workflow concludes with `success`.
- `Daily Health Check` creates no incident issue when the run passes.
- `Weekly Research Export` uploads the expected CSV artifacts.

### 4) Validate live runtime endpoints

```bash
curl -sS https://feed.corgi.network/health
curl -sSI https://docs.corgi.network/
```

Expected:
- feed health returns `{"status":"ok"}`.
- docs endpoint returns `200`.

### Post-deploy smoke test

```bash
curl -sS http://localhost:3001/health
curl -sS http://localhost:3001/health/ready
curl -sS http://localhost:3001/health/live

curl -sS "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&limit=10"

# Validation behavior checks
curl -i "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&limit=0"
curl -i "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&cursor=invalid"
```

Expected:
- health endpoints return healthy/ready/live
- feed skeleton returns posts + cursor
- invalid pagination inputs return `400 ValidationError`

## Backup and Retention

### DB backups

- Script: `/opt/backups/daily-backup.sh`
- Schedule (root crontab): `0 3 * * * /opt/backups/daily-backup.sh >> /opt/backups/backup.log 2>&1`
- Output dir: `/mnt/host-backups/postgres`
- `/opt/backups` is retained only for the installed script and cron log; backup
  data must stay under `/mnt/host-backups`
- Mount contract: `/mnt/host-backups` must be a real mounted filesystem or the
  backup producer exits non-zero before creating backup data directories on root
- Retention policy:
  - keep only the latest 5 valid `dump-YYYY-MM-DD.sql.gz` files
  - validate each PostgreSQL dump with `gzip -t` before it is retained
  - remove invalid/truncated `.sql.gz` dumps automatically
  - remove stale plain `.sql` files if any are left behind by an interrupted run

Verify backup mount before troubleshooting backup output:

```bash
findmnt -n -o TARGET --target /mnt/host-backups
findmnt /mnt/host-backups
df -hT /mnt/host-backups
mount | grep ' /mnt/host-backups '
```

The first command must print exactly `/mnt/host-backups`. If it prints `/` or
another parent mount, the dedicated backup volume is missing; backup scripts
will fail closed before creating backup data directories on root.

Quick verification:

```bash
sudo crontab -l
sudo find /mnt/host-backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl
sudo bash -lc 'shopt -s nullglob; for dump in /mnt/host-backups/postgres/dump-*.sql.gz; do gzip -t "$dump"; done'
sudo tail -n 200 /opt/backups/backup.log
```

## Ops Retention and Alerting

### Retention/cleanup script

- Script: `/usr/local/bin/bluesky-ops-retention.sh`
- Schedule (root crontab): `30 3 * * *`
- Actions:
  - force logrotate attempt
  - vacuum systemd journal to 300MB
  - enforce PostgreSQL backup retention on `/mnt/host-backups/postgres`
  - delete invalid/truncated PostgreSQL dumps before counting retained backups
  - prune unused docker containers/images (safe prune only)

### Disk/service alert script

- Script: `/usr/local/bin/bluesky-disk-alert.sh`
- Schedule (root crontab): `*/5 * * * *`
- Config: `/etc/default/bluesky-ops-alert`
  - `DISK_WARN_PCT` default `85`
  - `DISK_CRIT_PCT` default `92`
  - `ALERT_COOLDOWN_SEC` default `1800`
  - `ALERT_WEBHOOK_URL` optional
- Checks:
  - root filesystem usage
  - `bluesky-feed` service active
  - local `/health` endpoint reachable

Logs:

```bash
sudo journalctl -t bluesky-ops-retention -n 100 --no-pager
sudo journalctl -t bluesky-disk-alert -n 100 --no-pager
sudo grep -E "bluesky-ops-retention|bluesky-disk-alert" /var/log/syslog | tail -n 100
```

## Governance/Feed Integrity Spot Checks

Check current scoring run metadata:

```bash
psql "$DATABASE_URL" -At -c "SELECT value FROM system_status WHERE key='current_scoring_run';"
docker exec bluesky-feed-redis redis-cli get feed:run_id
docker exec bluesky-feed-redis redis-cli get feed:epoch
docker exec bluesky-feed-redis redis-cli zcard feed:current
```

Top-ranked URI consistency check:

```bash
TOP_REDIS=$(docker exec bluesky-feed-redis redis-cli zrevrange feed:current 0 0)
TOP_DB=$(psql "$DATABASE_URL" -At -c "WITH run AS (SELECT value->>'run_id' AS run_id, (value->>'epoch_id')::int AS epoch_id FROM system_status WHERE key='current_scoring_run') SELECT post_uri FROM post_scores ps, run r WHERE ps.epoch_id=r.epoch_id AND ps.component_details->>'run_id'=r.run_id ORDER BY total_score DESC LIMIT 1;")
echo "redis=$TOP_REDIS"
echo "db=$TOP_DB"
```

`redis` and `db` top URIs should match.

## Incident Playbooks

### 0) Backup mount missing

1. Confirm whether `/mnt/host-backups` is the exact mounted target:

```bash
findmnt -n -o TARGET --target /mnt/host-backups
findmnt /mnt/host-backups
df -hT /mnt/host-backups
```

1. Check that `/etc/fstab` still contains the backup-volume entry:

```bash
grep -F '/mnt/host-backups' /etc/fstab
```

1. If the `fstab` entry exists, mount it and verify the exact target again:

```bash
sudo mount /mnt/host-backups
findmnt -n -o TARGET --target /mnt/host-backups
```

1. If the mount still fails, or the `fstab` entry is missing, stop local
   backup work and route the incident to infrastructure/admin ownership to
   attach the DigitalOcean volume and restore the persistent `fstab` entry.

Backup and retention scripts intentionally exit non-zero when the mount is
missing. That fail-closed behavior protects root from orphan backup data; it
does not mean backup data was corrupted.

### 1) Disk pressure (`/` above 92%)

1. Confirm usage:

```bash
df -h /
du -xhd1 /var | sort -h
du -xhd1 /opt | sort -h
sudo du -sh /opt/backups
sudo du -xhd1 /mnt/host-backups | sort -h
du -xhd1 /home/corgi | sort -h
```

1. Run retention:

```bash
sudo /usr/local/bin/bluesky-ops-retention.sh
```

1. Verify the backup directory contains only the latest 5 valid dumps:

```bash
sudo find /mnt/host-backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl
sudo bash -lc 'shopt -s nullglob; for dump in /mnt/host-backups/postgres/dump-*.sql.gz; do gzip -t "$dump"; done'
```

1. Re-check `df -h /`.

### 2) Feed stale or empty

1. Check app and health:

```bash
sudo systemctl status bluesky-feed --no-pager
curl -sS http://localhost:3001/health
```

1. Check feed keys:

```bash
docker exec bluesky-feed-redis redis-cli zcard feed:current
docker exec bluesky-feed-redis redis-cli get feed:updated_at
```

1. Trigger manual rescore from admin UI.
1. Check logs for scoring errors:

```bash
sudo journalctl -u bluesky-feed -n 300 --no-pager | grep -Ei "scoring|error|redis|postgres"
```

### 3) Jetstream disconnected

1. Check health payload (`jetstream.connected`).
1. Inspect logs:

```bash
sudo journalctl -u bluesky-feed -n 300 --no-pager | grep -Ei "jetstream|websocket|reconnect"
```

1. Restart service if needed:

```bash
sudo systemctl restart bluesky-feed
```

### 4) PostgreSQL/Redis unavailable

1. Check container state:

```bash
cd /opt/bluesky-feed
docker compose -f docker-compose.prod.yml ps
```

1. Start infra if down:

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
```

1. Validate DB/Redis:

```bash
docker exec bluesky-feed-postgres pg_isready -U feed -d bluesky_feed
docker exec bluesky-feed-redis redis-cli ping
```

1. Restart app:

```bash
sudo systemctl restart bluesky-feed
```

## Rollback Procedure

If a deploy introduces a runtime regression:

```bash
cd /opt/bluesky-feed
git fetch origin
git checkout <known-good-sha-or-tag>
npm install --no-audit --no-fund
npm run build
npm run migrate
sudo systemctl restart bluesky-feed
```

Notes:
- DB migrations are forward-only by default.
- For destructive rollback needs, restore from backup first in a controlled maintenance window.

## Ownership and Review

- Update this file whenever:
  - service names/paths change
  - cron schedules change
  - backup retention policy changes
  - alert thresholds or channels change
- Review quarterly as part of security/ops audits.
