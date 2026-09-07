# PROJ-2268 repository design receipt

## Runtime Health Check

Production was not contacted. Repository-only validation runs the script plan,
shell syntax checks, and workflow policy tests without SSH, sudo, systemd, or
Docker mutation.

## Deterministic Eval

Repository validation completed successfully on the issue branch:

- `bash -n ops/corgi-deploy-root ops/provision-corgi-host-identity.sh`
- `shellcheck ops/corgi-deploy-root ops/provision-corgi-host-identity.sh`
- `actionlint .github/workflows/deploy.yml`
- `git diff --check`
- `npm run docs:verify` (15 tracked docs; 38 Markdown files scanned)
- `npm run build`
- focused Vitest policy run (2 files; 386 tests)
- `npm run verify` (158 test files; 2,177 tests; CLI, SDK, web lint/build,
  and Next production build)

Every command exited zero. The final Git commit is intentionally not
self-recorded in this immutable receipt; the reviewed exact head must be named
in the later production-authorization record.

## Live Acceptance

Deferred by authorization boundary. Live preflight, adoption, positive and
negative host tests, and rollback rehearsal require a separate founder approval
naming the reviewed exact commit. No key, account, `.env`, sudoers file, unit,
service, container, GitHub environment, deploy control, or freeze was changed.

### Automation Summary

- Packet: PROJ-2268
- Canonical repository: `https://github.com/andrewnordstrom-eng/corgi`
- Rename evidence (verified 2026-09-04): GitHub resolves both the canonical
  slug and legacy `andrewnordstrom-eng/bluesky-community-feed` slug to
  repository ID `1151738081` / node ID `R_kgDORKYg4Q`.
- Approval reference: the founder-authored 2026-09-04 `[APPROVED]` comment on
  PROJ-2268 authorizes this repository-only implementation, and PROJ-2268
  attaches PR #406 at the canonical `andrewnordstrom-eng/corgi` remote.
- Repository phase: admitted with founder-approved WIP-cap overrides
- Starting main: `c703244da266679a289109871920d0320f14ebf3`
- Production contact: none
- Production mutation: none
- Deployment: none
- Admin bypass: none
- Exact-head execution approval: required and not yet granted

## Configuration-integrity correction (2026-09-06)

Repository-only follow-up to the founder-approved host-adoption correction.
The configuration now lives under protected root-owned directory ancestry, and
production ignores working-directory dotenv files. Migration retains a root-only
recovery copy and syncs journal state before later mutations. The service unit
accepts notifications from its fixed helper children. The EXIT handler captures
the deployment identity before local function scope unwinds.

A disposable local Ubuntu 24.04 / systemd 255 container exercised the actual
provisioner, wrapper and service unit using distinct Linux UIDs and dummy
configuration. It passed apply, verification, repeat apply, six denied file/path
operations, rollback, failed-service-start automatic recovery, and eleven SIGKILL
recovery boundaries, including an incomplete initial journal.

Rehearsal scope: real systemd, sudo, Unix permissions, accounts, file migration
and rollback. The Node application and Docker dependency were explicit fixtures;
this does not establish production application health or live deployment readiness.
The container had no network or host filesystem mounts. The test uses
`CORGI_DUMMY_REHEARSAL=CONFIRM-DISPOSABLE-CONTAINER` and refuses a non-container
host. Test source: `tests/host-identity-linux.sh`.

The full validation and current-head hosted review must be refreshed before
publication. No production connection, service change, merge, deployment,
credential mutation or freeze change is part of this repository correction.

### Bootstrap trust correction

Hosted review identified writable-checkout execution and source-install races.
The execution contract now requires immutable Git blobs exported on the trusted
review workstation, an independently approved manifest digest, and root-protected
staging authenticated before script interpretation. The provisioner validates
bundle ancestry, revision and artifact hashes and never reads the deployment
checkout. The Linux rehearsal passed pre-interpretation rejection, post-admission
checkout replacement, failed-start recovery and all eleven interruption boundaries.
Full validation passed 2,188 tests, builds and lint; ShellCheck passed. Local review
found no blocking code issues.

Project linkage verified 2026-09-07 UTC: Bluesky Corgi is In Progress;
PROJ-2268 is In Review and linked to [PR #406](https://github.com/andrewnordstrom-eng/corgi/pull/406).
The canonical repository is [andrewnordstrom-eng/corgi](https://github.com/andrewnordstrom-eng/corgi),
GitHub repository ID `1151738081`. The existing project record already names this
repository; no project-record mutation was needed.
