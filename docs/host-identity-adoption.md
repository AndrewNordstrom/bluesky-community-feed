# Production host identity adoption

Status: PROJ-2268 repository-only design. Nothing in this document authorizes
an SSH connection, production mutation, deployment, migration, or service
restart.

## Decision

The application keeps `/opt/bluesky-feed` owned and writable by the deployment
user so the immutable-artifact workflow can swap reviewed releases. The
`bluesky-feed` process runs as a separate `bluesky-feed:bluesky-feed` system
identity with `/usr/sbin/nologin`, no supplementary groups, and no Docker
access. The systemd manager reads `/etc/corgi/production.env` before starting the
unprivileged process. Its directory and ancestry are root-owned and protected
from replacement. Neither non-root identity receives direct configuration-file
access. Production skips working-directory dotenv loading, so a newly created
application-directory `.env` cannot supply missing settings. The unit uses
`NotifyAccess=all` because readiness and watchdog messages come from the fixed
`systemd-notify` helper in the service cgroup.

The production environment target is:

```text
/etc/corgi                 root:root  0755  directory, never a symlink
/etc/corgi/production.env  root:root  0600  regular file, never a symlink
```

The deployment identity remains a trusted application publisher: permission
to replace application code is authority over code that receives runtime
secrets. These controls protect direct configuration-file integrity and limit
root privileges; they do not claim to hide runtime secrets from an arbitrary
code publisher.

The deployment user loses its existing unrestricted passwordless-sudo rule. It
receives one replacement target:

```text
DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/corgi-deploy-root
```

That executable is installed root-owned and mode 0755. It does not evaluate
caller text. Its closed dispatcher fixes each executable, systemd unit,
container, SQL statement, Redis command, and Redis configuration key. The only
dynamic value is a demo-session Redis key matching
`demo:session:demo-[A-Za-z0-9_-]{1,128}`.

## Reviewed command surface

| Token | Fixed privileged operation |
| --- | --- |
| `service-user` | Read the `User` property of `bluesky-feed` |
| `service-group` | Read the `Group` property of `bluesky-feed` |
| `service-main-pid` | Read the `MainPID` property of `bluesky-feed` |
| `service-is-active` | Check that `bluesky-feed` is active without output |
| `service-state` | Print the active state of `bluesky-feed` |
| `service-restart` | Restart only `bluesky-feed` |
| `service-can-read-entrypoint` | Prove the service user can traverse to and read the fixed production entry point |
| `postgres-ingestion-signals` | Run one fixed, read-only cursor/newest-post query in `bluesky-feed-postgres` |
| `demo-redis-ping` | Ping only `bluesky-feed-demo-redis` |
| `demo-redis-exists KEY` | Read one validated demo-session key from demo Redis |
| `production-redis-exists KEY` | Read the same validated demo-session key from production Redis |
| `demo-redis-maxmemory-policy` | Read one fixed demo Redis configuration value |
| `demo-redis-maxmemory` | Read one fixed demo Redis configuration value |
| `demo-redis-appendonly` | Read one fixed demo Redis configuration value |
| `demo-redis-save` | Read one fixed demo Redis configuration value |

The wrapper uses an empty environment with a fixed `PATH`, locale, and home.
Every container call has a 15-second outer deadline. Arbitrary `systemctl`,
`docker`, `docker exec`, shell, SQL, Redis, file, and service names are rejected.
After each candidate install and rollback restore, the workflow grants only
read/traverse bits on the fixed runtime-artifact paths and asks the wrapper to
prove `bluesky-feed` can read `/opt/bluesky-feed/dist/index.js` before restart.

## Reviewable execution vehicle

`ops/provision-corgi-host-identity.sh` is the only supported vehicle. It has
five modes:

1. `plan` is local and non-privileged. It describes the boundary without
   contacting a host.
2. `preflight DEPLOY_USER BROAD_SUDOERS_PATH` is read-only. It prints only file
   metadata and SHA-256 digests for the existing unit and broad sudoers file;
   it never reads or prints `.env` contents.
3. `apply` requires the exact observed digests, the exact reviewed repository
   SHA, and the literal confirmation phrase. It backs up the unit, sudoers
   policy, original configuration, and numeric ownership/mode before mutation.
   The recovery copy is root-only, and its digest stays in the root-only journal.
   Secret values are never printed or sent to a runner. A versioned journal is
   armed before state creation and records `create-pending` before each account
   or group mutation so interrupted identity setup remains reversible.
4. `verify DEPLOY_USER` proves the allow/deny matrix and active process
   identity without restarting anything.
5. `rollback DEPLOY_USER CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK` restores the
   pinned prior unit, sudoers file, original configuration path and ownership/mode,
   restarts the restored service, and removes only identities and configuration
   paths created by the script. Recovery intentionally restores the prior weaker
   boundary; it does not count as successful adoption.

Apply refuses a wrong-revision or changed bootstrap bundle, changed unit/sudoers hashes,
symlinks, foreign file owners, an inactive starting service, pre-existing
managed paths, malformed state, or an unexpected account shape. It refuses an existing `/etc/corgi` destination
and requires the installed unit to reference the expected legacy `.env`. The
migration retains a protected recovery copy and removes the legacy file before
starting the new unit. If an error
occurs after durable state is written, the guarded exit trap attempts the same
rollback path. A repeated successful `apply` runs verification and reports that
the contract is already applied.

## Future execution sequence

The following sequence is intentionally blocked until Andrew separately names
and approves the reviewed exact head for production execution.

First materialize the three artifacts with `git show APPROVED_REPOSITORY_SHA:ops/FILE`
on the trusted review workstation, never by copying its working tree. Produce a
`REVISION` file containing that exact commit and a `SHA256SUMS` manifest containing
only the three artifacts. Record the manifest's SHA-256 digest in the separately
approved execution receipt. The digest must come from that trusted receipt, not
from the upload or the deployment account.

Transfer these five data files through the separately authorized channel. In a
trusted root recovery session, stage and authenticate them **before Bash reads any
uploaded script**. For example, with the reviewed incoming directory and receipt
values substituted explicitly:

```sh
set -eu
bundle=/root/corgi-reviewed-bootstrap
incoming=/var/tmp/corgi-adoption-upload
approved_revision=APPROVED_REPOSITORY_SHA
approved_manifest_sha=APPROVED_MANIFEST_SHA256
# Refuse reuse, including symlinks; retain the bundle for verify and recovery.
mkdir -m 0700 "$bundle"
for name in REVISION SHA256SUMS provision-corgi-host-identity.sh corgi-deploy-root bluesky-feed.service; do
  install -o root -g root -m 0600 "$incoming/$name" "$bundle/$name"
done
printf '%s  %s\n' "$approved_manifest_sha" "$bundle/SHA256SUMS" | sha256sum --check --strict
test "$(cat "$bundle/REVISION")" = "$approved_revision"
(cd "$bundle" && sha256sum --check --strict SHA256SUMS)
```

Any staging or digest failure stops execution. Do not run an upload or a
checkout script as root to validate itself. Keep the staged directory and its
ancestry root-owned and non-writable by other users. The provisioner checks
those properties and every artifact digest again before admission. Installation
and verification use only these protected sources; subsequent deployment-checkout
edits cannot change the installed wrapper or unit. Root must remain trusted.

After successful independent authentication, use this retained bundle in the
same trusted root session with a clean environment:

```sh
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/bash "$bundle/provision-corgi-host-identity.sh" preflight DEPLOY_USER /etc/sudoers.d/EXISTING_POLICY

env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/bash "$bundle/provision-corgi-host-identity.sh" apply \
  DEPLOY_USER \
  /etc/sudoers.d/EXISTING_POLICY \
  OBSERVED_SUDOERS_SHA256 \
  OBSERVED_UNIT_SHA256 \
  APPROVED_REPOSITORY_SHA \
  CONFIRM-CORGI-HOST-IDENTITY-ADOPTION

env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/bash "$bundle/provision-corgi-host-identity.sh" verify DEPLOY_USER
```

Preflight output must be reviewed before apply. A digest or path change requires
a new review; it must not be worked around by substituting a broader path or
weakening the script.

## Positive and negative acceptance

Positive verification requires the protected configuration ancestry and absence
of the legacy `.env`, and requires the installed unit and wrapper to match the
reviewed sources, the service to be active, systemd `User`/`Group` to equal the
dedicated identity, the active `MainPID` UID/GID to match, the narrow sudoers
file to validate, and the deployment user to execute the fixed identity probe.
The production deploy workflow exercises the remaining fixed read-only probes
and the one service restart during a separately approved promotion.

Negative verification proves:

- deployment user cannot read, write, unlink, replace or rename the canonical configuration;
- service user cannot read the canonical configuration file or write `/opt/bluesky-feed`;
- neither user is in the Docker group;
- deployment user cannot run `sudo -n /usr/bin/true`;
- an unknown dispatcher token fails;
- workflow policy contains no direct privileged `systemctl` or `docker` call.

Tests do not attempt an unauthorized restart merely to prove denial. The
root-owned allowlist and sudoers shape establish that boundary statically.

## Rollback and dependencies

Rollback restores privilege and service state in this order: restore the prior
sudoers policy, remove the narrow rule, restore the original configuration and prior
unit with their recorded metadata, reload systemd, restart the restored unit,
remove only the matching managed configuration and dispatcher, and
delete the service account/group only if the state proves this script created
them and no process remains. Backups are SHA-256 verified before use. The state
directory is mode 0700 and its files are root-owned mode 0600. The environment
recovery copy is retained until rollback completes. Changed or foreign
configuration files stop recovery for explicit root review rather than being
overwritten. Power interruption and failed service start must be rehearsed on
isolated Linux with dummy values before host execution.

Before execution, confirm that the deployment SSH session remains usable and
that a separate root recovery path exists. After rollback, PROJ-2258 remains
blocked until a new successful adoption. No current workflow may dispatch
while adoption or rollback is in progress.

## Sources

- [systemd execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
- [OpenSSH portable source and forced-command behavior](https://github.com/openssh/openssh-portable)
- [sudoers command matching](https://www.sudo.ws/docs/man/1.9.14/sudoers.man.pdf)
- [NIST SP 800-53 Rev. 5 controls](https://csrc.nist.gov/Projects/risk-management/sp800-53-controls/downloads)
- Saltzer and Schroeder, [The Protection of Information in Computer Systems](https://doi.org/10.1109/PROC.1975.9939)

## Dependent consumers

Both production workflow admission blocks validate the canonical path and its
ancestry. Runner-only `.env.example` validation stays unchanged. The legacy
weekly export still depends on reading application configuration and remains
blocked under PROJ-2261; this packet does not grant it configuration access or
claim to repair it. PROJ-2258's future operations principal must be reviewed
against this adopted boundary before execution.

The deployment identity and sudoers path remain explicit preflight inputs.
Record verified host account names in private operational evidence. Root file
ownership does not require logging in over SSH as root.

## Isolated rehearsal

`tests/host-identity-linux.sh` runs only inside an explicitly confirmed disposable
Linux container with real systemd. Supply the three reviewed `ops` files under
`/fixture/source`. It creates only dummy identities, configuration and an
application fixture, then exercises successful adoption, denial of configuration
replacement, rollback, a failed service transition and eleven abrupt-interruption
boundaries. It also rejects a modified bootstrap before interpretation and
changes both checkout sources after admission to prove only the protected
approved artifacts reach the installed unit and dispatcher. The Docker service dependency is a fixture; no Docker socket is
exposed. This is migration acceptance evidence, not a production application
health receipt. Do not run the rehearsal against a real application host.

## Application revision boundary

Host adoption changes configuration ownership/location, sudo policy and the
service unit; it does not build or replace the running application's artifacts.
The production dotenv-loading correction takes effect when the corresponding
reviewed application revision is separately promoted. Record that revision
before claiming the loader correction is live. The deployment identity remains
a trusted code publisher throughout this sequence.

Rollback pins the installed dispatcher snapshot and refuses to remove a
dispatcher that was subsequently replaced, preserving it and the recovery
evidence for explicit root review.
