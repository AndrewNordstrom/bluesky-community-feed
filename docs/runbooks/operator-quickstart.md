# Operator Quickstart — bluesky-community-feed

Status: canonical operator runbook
Owner: bluesky-feed
Last updated: 2026-08-02

## Fast Path

1. Check service health:
   - `sudo systemctl status bluesky-feed --no-pager`
   - `curl -sS https://feed.corgi.network/health`
2. Check runtime dependencies:
   - `cd /opt/bluesky-feed && docker compose -f docker-compose.prod.yml ps`
3. Verify feed integrity:
   - `curl -sS "https://feed.corgi.network/xrpc/app.bsky.feed.describeFeedGenerator"`
4. If deploy-related, inspect the latest GitHub Actions deploy and journal logs.

## Health Checks

- Public health: `https://feed.corgi.network/health`
- Local health: `http://localhost:3001/health`
- Docs site: `https://docs.corgi.network/`
- Feed endpoint: `app.bsky.feed.getFeedSkeleton`
- systemd logs: `sudo journalctl -u bluesky-feed -n 200 --no-pager`

## Key Commands

- Service logs: `sudo journalctl -u bluesky-feed -f`
- Exact-SHA promotion and recovery run only through the protected `deploy.yml` workflow.
  Never run checkout, install, build, migration, or restart commands
  directly on the VPS as a deployment shortcut.
- Before enabling deployment, create and protect the GitHub `production`
  environment, require a reviewer, restrict it to `main`, add deployment-only
  `PRODUCTION_VPS_HOST`, `PRODUCTION_VPS_USER`, `PRODUCTION_VPS_SSH_KEY`, and
  `PRODUCTION_VPS_SSH_FINGERPRINT` secrets there, and set the repository-level Actions variable
  `CORGI_PRODUCTION_DEPLOY_ENABLED=true`. This is an explicit approval gate.
- Every workflow SSH connection must verify the VPS host key through the
  deployment-only SHA256 fingerprint secret. It is intentionally distinct from
  the OpenSSH `known_hosts` line used by other workflows. A missing or mismatched
  fingerprint is rejected by a non-printing local secret-shape gate before the
  first SSH connection, never a reason to disable verification.
- Dispatch with an exact 40-character lowercase hexadecimal reviewed `main`
  SHA. Abbreviated, uppercase, nonexistent, and non-`main` values must be
  rejected by the exact-SHA runner gate before the production approval and SSH
  mutation step can start.
- Production deploy and rollback mutations are serialized. Require a terminal receipt
  before dispatching another run; GitHub keeps one running and one
  pending run, and a newer dispatch can replace the older pending dispatch. A
  run-independent non-blocking host lock serializes every remote deploy and
  rollback process, including one that outlives the SSH connection after a timeout.
  The workflow itself rejects a new attempt when any prior receipt is `started`,
  `rollback_interrupted`, `rollback_failed`, malformed, or paired with an orphaned
  payload. Freeze dispatches and use the approval-gated incident procedure until
  that evidence is reconciled.
- The host preflight requires clean tracked state, no non-ignored untracked
  files, a revision-aware healthy current runtime matching the checkout, a
  forward-only target, and deployment-user ownership/writability for the repo,
  `.git`, dependency, and build directories. The production `.env` must exist,
  be root-owned, must not be a symlink, and must be unreadable and unwritable by
  the deployment user. That account must not have unrestricted passwordless
  sudo; review and restrict it to the exact systemd calls and fixed-container,
  fixed-command `docker exec` probes in this workflow before enablement. Do not
  allow `docker compose`, container creation, or free-form `docker exec`. The
  isolated demo Redis container must already be running. That host policy change is a separate approval
  gate. Archive the existing
  `.env*.bak` files outside the checkout through an approved recovery procedure
  before the first dispatch.
- Verify the GitHub Actions summary contains exactly one receipt with `status`,
  `requested`, `previous`, `built`, `deployed`, and `runtime` SHAs, migration set,
  production Compose change set, `operator`, UTC timestamp, and workflow URL. The
  recovery copy remains at
  `/opt/bluesky-feed/.git/corgi-deploy-receipts/<run-id>-<attempt>.receipt`.
  A `succeeded` receipt requires `requested=built=deployed=runtime`. A
  `rolled_back` receipt requires `built=requested` and
  `deployed=runtime=previous`.
- A successful promotion also proves a new process, an advancing Jetstream
  cursor, cursor/newest-post age at or below 120 seconds, and distinct nonzero
  pre/post-restart `MainPID` values. Probe failures use bounded HTTP/database
  timeouts and retries.
- The exact SHA builds on the GitHub runner without production secrets. Every
  workspace install disables lifecycle scripts, and every shipped workspace must
  pass a raw production dependency audit at the moderate threshold. Before any
  production credential is exposed, the runner verifies hardcoded SHA-256
  digests for the SSH/SCP action binaries and forces the pinned action wrappers
  to load only those local verified payloads. The runner stamps and transfers a
  checksummed runtime archive and forwards the runner-recorded 64-character
  digest independently from the transferred checksum file, so the VPS executes
  no candidate build tooling or self-authenticating archive/checksum pair.
  Only after the checksum, all candidate artifacts, and the release stamp verify does
  the workflow retain the current runtime directories and swap in the candidate.
  A fingerprinted read-only host admission runs before SCP and checks deployment
  paths, `.env`, sudo scope, a dedicated non-root service user and MainPID owner,
  host-lock availability, prior receipt/payload state, the exact incoming path,
  and at least 8 GiB free. The service user and group must both be explicit and
  distinct from the deployment user; the current root-running unit fails closed.
  Safe terminal attempts delete their large run-scoped
  payloads, and later runs reclaim only payloads with validated safe terminal
  receipts. Unresolved, rollback-failed, malformed, and receipt-less payloads
  remain for approval-gated recovery and automatically block another transfer;
  they are never age-deleted by the workflow.
  If transfer starts but no receipt is created, the capture step reports
  `transferred payload without receipt` as unresolved and requires the incident
  procedure; it never labels that state safe to redispatch.
  This M0 workflow blocks
  every changed SQL migration and every `docker-compose.prod.yml` change before
  rollback is armed. Migration-bearing
  releases need a separately approved isolated-database rehearsal that applies
  the migration, restores `PREV_COMMIT`, and proves previous-release health and
  representative reads/writes against the post-migration schema. Compose-bearing
  releases wait for the later rehearsed container-rollback lane.
- Automatic rollback is stage-aware and uses the retained previous runtime
  artifacts without registry access or rebuilding. A candidate failure before
  the artifact swap records `preflight_failed` and leaves the current process
  untouched. A failure after swap restores the retained release, restarts it,
  never down-migrates, and records `rolled_back` or `rollback_failed`. In a
  `rolled_back` receipt, `built` remains the requested candidate SHA while
  `deployed` and `runtime` identify the restored previous SHA. It writes
  `rollback_interrupted` before rollback begins so a bounded SSH timeout leaves
  an explicit retained sentinel. Sentinel-write failure is logged but never
  prevents restoration. The main deploy shell owns a single rollback through an
  atomic per-attempt guard; subshell failures delegate to it. The remote shell
  proves the restored runtime revision and active service; cursor advancement and
  cursor/newest-post freshness are advisory ingestion diagnostics during rollback.
  Its traps catch catchable failure and termination signals, but a hard kill or transport loss cannot be trapped. A
  `started` or `rollback_interrupted` receipt is unresolved and may leave the
  checkout on the requested SHA. In that state, freeze dispatches and open an
  approval-gated incident procedure; do not improvise a direct-VPS rollback.
- `/health/live` remains a process-liveness probe. `/health/ready` is the
  dependency-only probe used by the systemd watchdog and other restart-oriented
  probes; it requires database and Redis health. The direct-loopback-only
  `/health/promotion-ready` refuses proxy-forwarding headers and additionally
  requires the immutable release identity and both persisted
  ingestion signals within 120 seconds and rejects emergency disk pressure. Stale
  ingestion therefore blocks promotion without crash-looping the live service.
- If a promotion records `rolled_back` after its runtime SHA and readiness
  checks passed, inspect the ingestion freshness gate. A quiet window with no
  indexed post for more than 120 seconds intentionally fails M0 promotion.
  A `preflight_failed` receipt with `migrations=none` and `compose=none` can have
  the same cause. That preflight happens before application mutation, so the
  checkout and running service remain unchanged; use the same triage below.
  Read-only host inspection is permitted; only deployment mutations are forbidden.
  Confirm the cursor advances, both signals are present, both ages are at or
  below 120 seconds, and neither signal is ahead of the VPS clock before
  redispatching the same reviewed SHA. Any stale, missing, or future-dated
  signal still blocks redispatch. Sample both raw gate signals twice, about 30 seconds apart, and compute their
  ages against the VPS clock, matching the workflow:

  ```bash
  set -euo pipefail
  cd /opt/bluesky-feed
  FIRST_CURSOR_US="$(timeout 10s sudo docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -v ON_ERROR_STOP=1 -tA -c "SELECT COALESCE((SELECT cursor_us FROM jetstream_cursor WHERE id = 1)::text, 'MISSING');" | tr -d '[:space:]')"
  if ! printf '%s\n' "$FIRST_CURSOR_US" | grep -Eq '^((MISSING)|(0|[1-9][0-9]{0,17}))$'; then
    echo "Ingestion signal query returned empty or malformed output" >&2
    exit 1
  fi
  sleep 30
  SIGNALS="$(timeout 10s sudo docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -v ON_ERROR_STOP=1 -tA -c "SELECT COALESCE((SELECT cursor_us FROM jetstream_cursor WHERE id = 1)::text, 'MISSING') || '|' || COALESCE((SELECT FLOOR(EXTRACT(EPOCH FROM MAX(indexed_at)))::bigint::text FROM posts WHERE deleted = FALSE), 'MISSING');" | tr -d '[:space:]')"
  if ! printf '%s\n' "$SIGNALS" | grep -Eq '^((MISSING)|(0|[1-9][0-9]{0,17}))\|((MISSING)|(0|[1-9][0-9]{0,11}))$'; then
    echo "Ingestion signal query returned empty or malformed output" >&2
    exit 1
  fi
  HOST_EPOCH="$(date +%s)"
  IFS='|' read -r CURSOR_US NEWEST_POST_EPOCH <<< "$SIGNALS"
  if [ "$CURSOR_US" = "MISSING" ]; then CURSOR_AGE_S="MISSING"; else CURSOR_AGE_S="$((HOST_EPOCH - CURSOR_US / 1000000))"; fi
  if [ "$NEWEST_POST_EPOCH" = "MISSING" ]; then NEWEST_POST_AGE_S="MISSING"; else NEWEST_POST_AGE_S="$((HOST_EPOCH - NEWEST_POST_EPOCH))"; fi
  if [ "$FIRST_CURSOR_US" = "MISSING" ] || [ "$CURSOR_US" = "MISSING" ]; then
    CURSOR_ADVANCING="MISSING"
  elif [ "$CURSOR_US" -gt "$FIRST_CURSOR_US" ]; then
    CURSOR_ADVANCING="yes"
  else
    CURSOR_ADVANCING="no"
  fi
  printf 'cursor_advancing=%s cursor_us=%s cursor_age_s=%s newest_post_epoch=%s newest_post_age_s=%s host_epoch=%s\n' "$CURSOR_ADVANCING" "$CURSOR_US" "$CURSOR_AGE_S" "$NEWEST_POST_EPOCH" "$NEWEST_POST_AGE_S" "$HOST_EPOCH"
  ```

  This read-only diagnostic uses the workflow's fixed container, timeout,
  PostgreSQL argv, and fail-fast settings, but substitutes `MISSING` markers so
  an operator can distinguish an absent cursor from an empty posts table. The
  promotion gate itself treats either missing value as a hard failure.
  `cursor_advancing=yes` means the cursor increased between the two ~30-second
  samples (the "Cursor increasing" cases below); `cursor_advancing=no` means it
  did not (the "Cursor static" case).

  `cursor_us` is microseconds since the Unix epoch, so divide it by 1,000,000
  before subtracting it from the VPS `date +%s` value. Interpret both computed
  ages because either can block promotion:
  - The workflow compares both signals with the VPS host clock. If it reports
    `Ingestion signals are ahead of host time`, reconcile host and database time
    before redispatching; do not classify that result as fresh or stale. A signal
    300 seconds ahead or behind the VPS clock fails the same 120-second bounds;
    never use the database clock to make a skewed signal appear fresh.
  - Cursor increasing and `newest_post_age_s` at or below 120: the failure was
    transient; redispatch the same reviewed SHA.
  - Cursor increasing and `newest_post_age_s` above 120: ingestion is reading the
    firehose but indexing no qualifying posts. Investigate ingestion filters and
    the embedding gate; do not redispatch because promotion will fail identically.
  - Cursor static: Jetstream ingestion is stalled. Investigate the WebSocket
    connection; do not redispatch.
  - `newest_post_epoch=MISSING` and `newest_post_age_s=MISSING`: no
    non-deleted post exists, so the workflow reports a missing ingestion signal
    rather than ordinary staleness. Investigate the `posts` table and any recent
    restore or purge; do not redispatch.
  - `cursor_us=MISSING` and `cursor_age_s=MISSING`: the singleton
    `jetstream_cursor` row is absent. Investigate cursor persistence and any recent
    restore before redispatching.

- Container status: `docker compose -f docker-compose.prod.yml ps`
- Backup verification:
  `find /mnt/host-backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl`

## When To Go Deeper

Use `docs/OPS_RUNBOOK.md` for disk pressure, stale feed, backup, and workflow
validation procedures. Use `docs/runbooks/incident-response.md` when the service
is degraded rather than just being checked.
