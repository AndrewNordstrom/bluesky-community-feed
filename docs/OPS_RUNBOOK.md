# Operations Runbook

This runbook covers day-2 operations for the production Bluesky feed stack.
It is written for the current VPS deployment model and can be adapted for other hosts.

Commands that mutate the host or GitHub workflows require a separate explicit
production gate. Reading status, logs, and health endpoints does not grant
permission to deploy, migrate, restart, or activate services.

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

## Deployment Gate (main branch)

The current `.github/workflows/deploy.yml` is a manual exact-SHA promotion
gateway. It rejects commits that are not on `main`, verifies the candidate on a
runner, requires `CORGI_PRODUCTION_DEPLOY_ENABLED=true`, and gates production
mutation through the protected `production` environment.

- do not dispatch or approve `Deploy to VPS` without an explicit production
  gate;
- do not use a manual pull/build/migrate/restart sequence as a substitute;
- require exact-head CI and record the full 40-character candidate SHA;
- treat `/health/ready` as a database-and-Redis dependency check, not proof of
  ingestion freshness, scoring freshness, feed integrity, or release fitness.

The loopback-only `/health/promotion-ready` route is an internal input to the
promotion workflow and must remain absent from public OpenAPI artifacts. Its
response is only one composite-health input: the workflow separately binds the
requested, built, deployed, and process-reported revisions to the intended full
SHA. Loopback access or a successful route response alone is never release
authorization or release evidence.

## Post-Transfer Validation (Manual Dispatch)

Use this after repository ownership transfer and for recurring manual verification.
This project intentionally uses a deploy-only model for ongoing checks (no extra scheduled smoke workflow).

Set the repo target once for read-only verification:

```bash
REPO="andrewnordstrom-eng/corgi"
```

### 1) Verify required repository secrets

```bash
gh secret list --repo "$REPO"
```

Expected required names:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `DATABASE_URL`
- `EXPORT_ANONYMIZATION_SALT`

### 2) Inspect workflow history on `main`

Inspect existing runs without dispatching a production workflow:

```bash
CANDIDATE_SHA="<full-40-character-main-sha>"
gh run list \
  --repo "$REPO" \
  --branch main \
  --commit "$CANDIDATE_SHA" \
  --limit 50 \
  --json databaseId,workflowName,headSha,status,conclusion,url
```

Every accepted CI receipt must be successful and have `headSha` exactly equal
to `CANDIDATE_SHA`. Inspect deployment receipts separately: a deploy is valid
only when the exact-SHA gateway reports the same requested, built, deployed,
and runtime SHA. Historical success does not prove the current checkout is
deployable or that a new workflow dispatch is authorized.

### 3) Validate live runtime endpoints

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
