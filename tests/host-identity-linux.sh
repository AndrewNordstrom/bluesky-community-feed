#!/bin/bash
set -Eeuo pipefail
[[ -f /.dockerenv && "${CORGI_DUMMY_REHEARSAL:-}" == 'CONFIRM-DISPOSABLE-CONTAINER' ]] || { echo 'Disposable container confirmation required' >&2; exit 1; }
[[ "$(id -u)" == 0 && -d /run/systemd/system ]] || { echo 'Isolated root and real systemd required' >&2; exit 1; }
assert_absent() {
  local target=''
  for target in "$@"; do
    [[ ! -e "$target" && ! -L "$target" ]] || {
      printf 'FAIL unexpected residue: %s\n' "$target" >&2
      return 1
    }
  done
}
absence_fixture="$(mktemp -d /root/corgi-absence.XXXXXX)"
ln -s "$absence_fixture/missing" "$absence_fixture/dangling"
if assert_absent "$absence_fixture/dangling"; then
  echo 'FAIL absence assertion accepted a dangling symlink' >&2; exit 1
fi
rm -- "$absence_fixture/dangling"
assert_absent "$absence_fixture/dangling"
rmdir -- "$absence_fixture"
printf 'PASS absence assertion rejects dangling symlinks\n'
source_dir=/fixture/source
repo=/fixture/repo
useradd -m -s /bin/bash deploy-fixture
install -d -o deploy-fixture -g deploy-fixture -m 0755 "$repo" "$repo/ops" /opt/bluesky-feed /opt/bluesky-feed/dist
for name in provision-corgi-host-identity.sh corgi-deploy-root bluesky-feed.service; do
  install -o deploy-fixture -g deploy-fixture -m 0644 "$source_dir/$name" "$repo/ops/$name"
done
runuser -u deploy-fixture -- git -C "$repo" init -q
runuser -u deploy-fixture -- git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid add ops
runuser -u deploy-fixture -- git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm 'Synthetic rehearsal snapshot'
revision="$(runuser -u deploy-fixture -- git -C "$repo" rev-parse HEAD)"
# Capture approval from immutable synthetic Git blobs, before any checkout mutation.
# Real approval must supply these digests independently from the trusted reviewed revision.
stage=/root/corgi-reviewed-bootstrap
install -d -o root -g root -m 0700 "$stage"
printf '%s\n' "$revision" > "$stage/REVISION"
for name in provision-corgi-host-identity.sh corgi-deploy-root bluesky-feed.service; do
  runuser -u deploy-fixture -- git -C "$repo" show "$revision:ops/$name" > "$stage/$name"
  chmod 0600 "$stage/$name"
  printf '%s  %s\n' "$(sha256sum "$stage/$name" | cut -d' ' -f1)" "$name" >> "$stage/SHA256SUMS"
done
chmod 0600 "$stage/REVISION" "$stage/SHA256SUMS"
approved_manifest_sha="$(sha256sum "$stage/SHA256SUMS" | cut -d' ' -f1)"

# This is the external trust check: it runs before Bash reads the provisioner.
verify_bootstrap() {
  [[ "$(stat -c '%U:%G:%a' "$stage")" == root:root:700 ]] || return 1
  [[ "$(sha256sum "$stage/SHA256SUMS" | cut -d' ' -f1)" == "$approved_manifest_sha" ]] || return 1
  [[ "$(cat "$stage/REVISION")" == "$revision" ]] || return 1
  (cd "$stage" && sha256sum --check --strict SHA256SUMS) || return 1
}
printf 'deploy-fixture ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/fixture-deployment
chmod 0440 /etc/sudoers.d/fixture-deployment
printf 'DUMMY_CONFIGURATION=fixture-only\n' > /opt/bluesky-feed/.env
chown deploy-fixture:deploy-fixture /opt/bluesky-feed/.env
chmod 0600 /opt/bluesky-feed/.env
legacy_sha="$(sha256sum /opt/bluesky-feed/.env | cut -d' ' -f1)"
cat > /opt/bluesky-feed/dist/index.js <<'APP'
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
if (process.env.DUMMY_CONFIGURATION !== 'fixture-only') process.exit(42);
if (process.getuid() !== 0 && fs.existsSync('/opt/bluesky-feed/fail-new-identity')) process.exit(43);
const result = spawnSync('/usr/bin/systemd-notify', ['--ready'], {stdio: 'inherit'});
if (result.status !== 0) process.exit(44);
setInterval(() => spawnSync('/usr/bin/systemd-notify', ['WATCHDOG=1']), 1000);
APP
chmod 0644 /opt/bluesky-feed/dist/index.js
# Docker dependency is a declared fixture; no Docker socket is exposed.
cat > /etc/systemd/system/docker.service <<'UNIT'
[Service]
Type=oneshot
ExecStart=/usr/bin/true
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
sed -e 's/^User=bluesky-feed$/User=root/' -e 's/^Group=bluesky-feed$/Group=root/' -e 's@^EnvironmentFile=.*@EnvironmentFile=/opt/bluesky-feed/.env@' "$repo/ops/bluesky-feed.service" > /etc/systemd/system/bluesky-feed.service
chmod 0644 /etc/systemd/system/bluesky-feed.service
# Model the observed production overrides and a root-only Docker boundary.
dropin_dir=/etc/systemd/system/bluesky-feed.service.d
managed_dropin="$dropin_dir/90-corgi-host-identity.conf"
install -d -o root -g root -m 0755 "$dropin_dir"
printf '[Service]\nExecStartPre=/usr/local/bin/bluesky-feed-ensure-deps.sh\n' > "$dropin_dir/10-dependencies.conf"
printf '[Service]\nWatchdogSec=180\n' > "$dropin_dir/20-watchdog-hotfix.conf"
printf '[Service]\nEnvironment=WEB_DIST_DIR=web-next/out\nEnvironment=WEB_ROUTING_MODE=export\n' > "$dropin_dir/web-next-cutover.conf"
chmod 0644 "$dropin_dir"/*.conf
cat > /usr/local/bin/bluesky-feed-ensure-deps.sh <<'HOOK'
#!/bin/bash
set -euo pipefail
cd /opt/bluesky-feed
/usr/bin/docker compose -f docker-compose.prod.yml up -d postgres redis
HOOK
chmod 0755 /usr/local/bin/bluesky-feed-ensure-deps.sh
cat > /usr/bin/docker <<'DOCKER'
#!/bin/bash
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Fixture Docker socket requires root' >&2; exit 1; }
if [[ "$*" == 'compose -f docker-compose.prod.yml up -d postgres redis' ]]; then
  printf 'legacy-compose\n' >> /dev/shm/corgi-fixture-docker-calls
elif [[ "$#" == 4 && "$1" == inspect && "$2" == --format && "$3" == '{{.State.Status}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}' &&
        ( "$4" == bluesky-feed-postgres || "$4" == bluesky-feed-redis ) ]]; then
  printf 'root-inspect:%s\n' "$4" >> /dev/shm/corgi-fixture-docker-calls
  if [[ -f /run/corgi-fixture-dependencies-unhealthy ]]; then
    printf 'running|unhealthy|unless-stopped\n'
  elif [[ -f /run/corgi-fixture-ready-at && "$(date +%s)" -lt "$(cat /run/corgi-fixture-ready-at)" ]]; then
    printf 'running|starting|unless-stopped\n'
  else
    printf 'running|healthy|unless-stopped\n'
  fi
else
  printf 'Unexpected fixture Docker arguments: %s\n' "$*" >&2
  exit 64
fi
DOCKER
chmod 0755 /usr/bin/docker
systemctl daemon-reload
systemctl enable docker.service
systemctl start bluesky-feed
systemctl is-active --quiet bluesky-feed
printf 'PASS original fixture service active with actual systemd\n'
unit_sha="$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)"
sudoers_sha="$(sha256sum /etc/sudoers.d/fixture-deployment | cut -d' ' -f1)"
provisioner="$stage/provision-corgi-host-identity.sh"
run_provisioner() {
  verify_bootstrap || return 1
  bash "$provisioner" "$@"
}
run_harness() {
  verify_bootstrap || return 1
  CORGI_HOST_IDENTITY_LIBRARY_ONLY=1 bash "$@"
}
apply() {
  run_provisioner apply deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_boundary_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION
}
rollback() {
  run_provisioner rollback deploy-fixture CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK || return 1
  [[ "$(sha256sum /opt/bluesky-feed/.env | cut -d' ' -f1)" == "$legacy_sha" ]]
  [[ "$(stat -c '%U:%G:%a' /opt/bluesky-feed/.env)" == 'deploy-fixture:deploy-fixture:600' ]]
  [[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$unit_sha" ]]
  assert_absent /etc/corgi /var/lib/corgi-host-adoption "$managed_dropin"
  [[ "$(systemctl show bluesky-feed --property=User --value)" == root ]]
  [[ "$(systemctl show bluesky-feed --property=ExecStartPre --value)" == *'/usr/local/bin/bluesky-feed-ensure-deps.sh'* ]]
  [[ "$(run_provisioner preflight deploy-fixture /etc/sudoers.d/fixture-deployment | sed -n 's/^unit_boundary_sha256=//p')" == "$unit_boundary_sha" ]]
  systemctl is-active --quiet bluesky-feed
}
# Reproduce the host defect: changing only User/Group leaves the old hook active.
cp /etc/systemd/system/bluesky-feed.service /root/fixture-original.service
sed -i -e 's/^User=root$/User=deploy-fixture/' -e 's/^Group=root$/Group=deploy-fixture/' /etc/systemd/system/bluesky-feed.service
systemctl daemon-reload
if systemctl restart bluesky-feed; then echo 'FAIL inherited root-only hook unexpectedly succeeded unprivileged' >&2; exit 1; fi
[[ "$(systemctl show bluesky-feed --property=ExecStartPre --value)" == *'status=1'* ]]
install -o root -g root -m 0644 /root/fixture-original.service /etc/systemd/system/bluesky-feed.service
systemctl daemon-reload
systemctl reset-failed bluesky-feed
systemctl restart bluesky-feed
printf 'PASS reproduced inherited Docker hook failure with unprivileged service identity\n'
unit_boundary_sha="$(run_provisioner preflight deploy-fixture /etc/sudoers.d/fixture-deployment | sed -n 's/^unit_boundary_sha256=//p')"
[[ "$unit_boundary_sha" =~ ^[0-9a-f]{64}$ ]]

# Admission must reject effective overrides and digest changes before mutation.
for mutation in unknown directive symlink unloaded digest hook; do
  case "$mutation" in
    unknown) printf '[Service]\nExecStartPre=/usr/bin/true\n' > "$dropin_dir/99-foreign.conf"; systemctl daemon-reload ;;
    directive) printf 'User=root\n' >> "$dropin_dir/20-watchdog-hotfix.conf"; systemctl daemon-reload ;;
    symlink) ln -s /root/fixture-original.service "$dropin_dir/99-foreign.conf"; systemctl daemon-reload ;;
    unloaded) printf '# not reloaded\n' >> "$dropin_dir/20-watchdog-hotfix.conf" ;;
    digest) printf '# reviewed bytes changed\n' >> "$dropin_dir/20-watchdog-hotfix.conf"; systemctl daemon-reload ;;
    hook) printf '# hook bytes changed\n' >> /usr/local/bin/bluesky-feed-ensure-deps.sh ;;
  esac
  if apply; then echo "FAIL admission accepted $mutation override" >&2; exit 1; fi
  assert_absent /var/lib/corgi-host-adoption /etc/corgi "$managed_dropin"
  [[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$unit_sha" ]]
  case "$mutation" in
    unknown|symlink) rm "$dropin_dir/99-foreign.conf" ;;
    directive|unloaded|digest) sed -i '$d' "$dropin_dir/20-watchdog-hotfix.conf" ;;
    hook) sed -i '$d' /usr/local/bin/bluesky-feed-ensure-deps.sh ;;
  esac
  systemctl daemon-reload
  printf 'PASS rejected %s startup boundary mutation before adoption\n' "$mutation"
done

# Replacing a checkout script after approval must fail BEFORE it can execute as root.
printf 'touch /etc/corgi-untrusted-bootstrap-ran\n' | runuser -u deploy-fixture -- tee "$repo/ops/provision-corgi-host-identity.sh" >/dev/null
install -o root -g root -m 0600 "$repo/ops/provision-corgi-host-identity.sh" "$provisioner"
if apply; then echo 'FAIL accepted a modified bootstrap' >&2; exit 1; fi
assert_absent /etc/corgi-untrusted-bootstrap-ran /etc/corgi /etc/sudoers.d/corgi-deploy /var/lib/corgi-host-adoption
[[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$unit_sha" ]]
[[ "$(sha256sum /etc/sudoers.d/fixture-deployment | cut -d' ' -f1)" == "$sudoers_sha" ]]
runuser -u deploy-fixture -- git -C "$repo" show "$revision:ops/provision-corgi-host-identity.sh" > "$provisioner"
verify_bootstrap
printf 'PASS changed checkout bootstrap rejected before interpretation or host-policy mutation\n'

# Exercise the intact provisioner's internal admission checks in isolation.
# Production must still use verify_bootstrap before interpretation. These cases
# deliberately corrupt only data artifacts inside this disposable fixture;
# independently pin the script bytes before every direct invocation.
intact_provisioner_sha="$(sha256sum "$provisioner" | cut -d' ' -f1)"
original_main_pid="$(systemctl show bluesky-feed --property=MainPID --value)"
for mutation in wrapper manifest ancestry; do
  verify_bootstrap
  case "$mutation" in
    wrapper)
      printf '\n# corrupted fixture artifact\n' >> "$stage/corgi-deploy-root"
      expected_error='bootstrap artifact differs from approved manifest: corgi-deploy-root' ;;
    manifest)
      printf '%s  extra-artifact\n' "$intact_provisioner_sha" >> "$stage/SHA256SUMS"
      expected_error='bootstrap manifest must contain exactly three artifacts' ;;
    ancestry)
      chmod 0770 "$stage"
      expected_error='bootstrap ancestry must be root-owned and not group/other writable' ;;
  esac
  [[ "$(sha256sum "$provisioner" | cut -d' ' -f1)" == "$intact_provisioner_sha" ]]
  if output="$(bash "$provisioner" apply deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_boundary_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION 2>&1)"; then
    echo "FAIL internal admission accepted $mutation" >&2; exit 1
  fi
  [[ "$output" == *"$expected_error"* ]]
  assert_absent /etc/corgi /etc/sudoers.d/corgi-deploy /var/lib/corgi-host-adoption
  assert_absent /usr/local/sbin/corgi-deploy-root
  [[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$unit_sha" ]]
  [[ "$(sha256sum /etc/sudoers.d/fixture-deployment | cut -d' ' -f1)" == "$sudoers_sha" ]]
  [[ "$(sha256sum /opt/bluesky-feed/.env | cut -d' ' -f1)" == "$legacy_sha" ]]
  [[ "$(systemctl show bluesky-feed --property=MainPID --value)" == "$original_main_pid" ]]
  systemctl is-active --quiet bluesky-feed
  case "$mutation" in
    wrapper) runuser -u deploy-fixture -- git -C "$repo" show "$revision:ops/corgi-deploy-root" > "$stage/corgi-deploy-root" ;;
    manifest) sed -i '$d' "$stage/SHA256SUMS" ;;
    ancestry) chmod 0700 "$stage" ;;
  esac
  verify_bootstrap
  printf 'PASS intact provisioner rejects %s mutation without target changes\n' "$mutation"
done

# Independently validate post-validation mutations using a root-only DEBUG harness.
# It edits the deployment checkout at the first state-directory write, after all admission checks.
install -d -o root -g root -m 0700 /root/corgi-rehearsal-harness
cat > /root/corgi-rehearsal-harness/bootstrap-race.sh <<'RACE'
set -Eeuo pipefail
source "$1"
shift
race_done=false
mutate_checkout() {
  if [[ "$race_done" == false && "$1" == apply_policy && "$2" == */usr/bin/install*STATE_DIR* ]]; then
    race_done=true
    printf 'touch /etc/corgi-untrusted-wrapper-ran\n' | runuser -u deploy-fixture -- tee /fixture/repo/ops/corgi-deploy-root >/dev/null
    printf '[Service]\nExecStart=/usr/bin/false\n' | runuser -u deploy-fixture -- tee /fixture/repo/ops/bluesky-feed.service >/dev/null
  fi
}
set -T
trap 'mutate_checkout "${FUNCNAME[0]:-}" "$BASH_COMMAND"' DEBUG
apply_policy "$@"
[[ "$race_done" == true ]]
RACE
chmod 0600 /root/corgi-rehearsal-harness/bootstrap-race.sh
run_provisioner preflight deploy-fixture /etc/sudoers.d/fixture-deployment
run_harness /root/corgi-rehearsal-harness/bootstrap-race.sh "$provisioner" deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_boundary_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION
assert_absent /etc/corgi-untrusted-wrapper-ran
[[ "$(sha256sum /usr/local/sbin/corgi-deploy-root | cut -d' ' -f1)" == "$(sha256sum "$stage/corgi-deploy-root" | cut -d' ' -f1)" ]]
[[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$(sha256sum "$stage/bluesky-feed.service" | cut -d' ' -f1)" ]]
printf 'PASS checkout source replacement after admission cannot change installed privileged artifacts\n'

run_provisioner verify deploy-fixture
apply
[[ "$(systemctl show bluesky-feed --property=ExecStartPre --value)" == *'/usr/local/sbin/corgi-deploy-root production-dependencies-ready'* ]]
[[ "$(systemctl show bluesky-feed --property=ExecStartPre --value)" != *'bluesky-feed-ensure-deps'* ]]
[[ "$(systemctl show bluesky-feed --property=WatchdogUSec --value)" == '3min' ]]
[[ "$(systemctl show bluesky-feed --property=Environment --value)" == *'WEB_ROUTING_MODE=export'* ]]
[[ "$(systemctl show bluesky-feed --property=Environment --value)" == *'WEB_DIST_DIR=web-next/out'* ]]
legacy_calls="$(grep -c '^legacy-compose$' /dev/shm/corgi-fixture-docker-calls)"
printf '%s\n' "$(( $(date +%s) + 4 ))" > /run/corgi-fixture-ready-at
start_time="$(date +%s)"
systemctl restart bluesky-feed
[[ "$(( $(date +%s) - start_time ))" -ge 4 ]]
[[ "$(grep -c '^legacy-compose$' /dev/shm/corgi-fixture-docker-calls)" == "$legacy_calls" ]]
grep -q '^root-inspect:bluesky-feed-postgres$' /dev/shm/corgi-fixture-docker-calls
grep -q '^root-inspect:bluesky-feed-redis$' /dev/shm/corgi-fixture-docker-calls
run_provisioner verify deploy-fixture
rm /run/corgi-fixture-ready-at
printf 'PASS root-only dependency wait precedes unprivileged app; watchdog and routing preserved; no Compose invoked\n'

# Preserve a foreign replacement before any rollback changes.
printf '# foreign override replacement\n' >> "$managed_dropin"
changed_dropin_sha="$(sha256sum "$managed_dropin" | cut -d' ' -f1)"
if run_provisioner rollback deploy-fixture CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK; then
  echo 'FAIL rollback accepted replaced startup override' >&2; exit 1
fi
[[ "$(sha256sum "$managed_dropin" | cut -d' ' -f1)" == "$changed_dropin_sha" ]]
assert_absent /etc/sudoers.d/fixture-deployment
[[ -f /etc/corgi/production.env && -f /var/lib/corgi-host-adoption/state ]]
install -o root -g root -m 0644 /var/lib/corgi-host-adoption/startup-override.installed "$managed_dropin"
systemctl daemon-reload
printf 'PASS rejected rollback preserves foreign startup override and recovery evidence\n'
for operation in read write unlink rename symlink ancestor; do
  case "$operation" in
    read) command=(cat /etc/corgi/production.env) ;;
    write) command=(sh -c 'printf dummy >> /etc/corgi/production.env') ;;
    unlink) command=(rm /etc/corgi/production.env) ;;
    rename)
      runuser -u deploy-fixture -- sh -c 'printf dummy > /opt/bluesky-feed/replacement'
      command=(mv -f /opt/bluesky-feed/replacement /etc/corgi/production.env) ;;
    symlink) command=(ln -sf /opt/bluesky-feed/replacement /etc/corgi/production.env) ;;
    ancestor) command=(mv /etc/corgi /etc/corgi-replaced) ;;
  esac
  if runuser -u deploy-fixture -- "${command[@]}" >/dev/null 2>&1; then
    echo "FAIL protected configuration allowed $operation" >&2; exit 1
  fi
  printf 'PASS actual deployment user denied %s\n' "$operation"
done
# A root caller cannot turn privileged probes into successful no-ops via a library hook.
if CORGI_DEPLOY_ROOT_LIBRARY_ONLY=1 /usr/local/sbin/corgi-deploy-root service-is-active; then
  echo 'FAIL root dispatcher accepted library-only mode' >&2; exit 1
fi
[[ "$(runuser -u deploy-fixture -- sudo -n -- /usr/local/sbin/corgi-deploy-root service-user)" == bluesky-feed ]]
runuser -u deploy-fixture -- env CORGI_DEPLOY_ROOT_LIBRARY_ONLY=1 bash -c 'source /usr/local/sbin/corgi-deploy-root; require_demo_session_key demo:session:demo-fixture'
printf 'PASS root dispatcher rejects library hook; normal sudo and non-root helpers work\n'

# A later root-managed dispatcher replacement must survive a rejected rollback.
printf '\n# independently replaced fixture dispatcher\n' >> /usr/local/sbin/corgi-deploy-root
changed_wrapper_sha="$(sha256sum /usr/local/sbin/corgi-deploy-root | cut -d' ' -f1)"
if run_provisioner rollback deploy-fixture CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK; then
  echo 'FAIL rollback accepted a replaced dispatcher' >&2; exit 1
fi
[[ "$(sha256sum /usr/local/sbin/corgi-deploy-root | cut -d' ' -f1)" == "$changed_wrapper_sha" ]]
[[ -f /etc/corgi/production.env && -f /var/lib/corgi-host-adoption/state ]]
printf 'PASS rejected rollback preserved replaced dispatcher and recovery evidence\n'
install -o root -g root -m 0755 /var/lib/corgi-host-adoption/dispatcher.installed /usr/local/sbin/corgi-deploy-root
rollback
printf 'PASS successful apply, verify, repeat apply and rollback\n'
# Cause an actual new-identity service start failure; original identity remains runnable.
touch /opt/bluesky-feed/fail-new-identity
if apply; then echo 'FAIL expected service-transition failure' >&2; exit 1; fi
rm /opt/bluesky-feed/fail-new-identity
systemctl is-active --quiet bluesky-feed
[[ "$(sha256sum /opt/bluesky-feed/.env | cut -d' ' -f1)" == "$legacy_sha" ]]
assert_absent /var/lib/corgi-host-adoption /etc/corgi
printf 'PASS failed service transition automatically restored original service and configuration\n'

# Dependencies can fail after admission; the bounded startup wait must roll back.
cat > /root/corgi-rehearsal-harness/dependency-failure.sh <<'FAULT'
set -Eeuo pipefail
source "$1"
shift
set -T
trap 'if [[ "${FUNCNAME[0]:-}" == "apply_policy" && "$BASH_COMMAND" == assert_managed_startup ]]; then touch /run/corgi-fixture-dependencies-unhealthy; fi' DEBUG
apply_policy "$@"
FAULT
chmod 0600 /root/corgi-rehearsal-harness/dependency-failure.sh
start_time="$(date +%s)"
if run_harness /root/corgi-rehearsal-harness/dependency-failure.sh "$provisioner" deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_boundary_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION; then
  echo 'FAIL unhealthy dependencies permitted adoption' >&2; exit 1
fi
[[ "$(( $(date +%s) - start_time ))" -lt 90 ]]
rm /run/corgi-fixture-dependencies-unhealthy
assert_absent /var/lib/corgi-host-adoption /etc/corgi "$managed_dropin"
systemctl is-active --quiet bluesky-feed
[[ "$(systemctl show bluesky-feed --property=User --value)" == root ]]
printf 'PASS bounded dependency failure restored original service and overrides\n'

# Exhaust the real systemd start limiter before explicit recovery.
systemctl reset-failed bluesky-feed
apply
touch /opt/bluesky-feed/fail-new-identity
for attempt in 1 2 3 4 5 6; do
  previous_start="$(systemctl show bluesky-feed --property=ExecMainStartTimestampMonotonic --value)"
  if systemctl restart bluesky-feed; then
    echo "FAIL expected new-identity failure at attempt $attempt" >&2; exit 1
  fi
done
# systemd 255 may retain Result=exit-code from the last process even when the
# limiter refuses later requests. Prove the final refusal launched no new process.
[[ "$previous_start" != 0 ]]
[[ "$(systemctl show bluesky-feed --property=ExecMainStartTimestampMonotonic --value)" == "$previous_start" ]]
[[ "$(systemctl show bluesky-feed --property=ActiveState --value)" == failed ]]
rollback
rm /opt/bluesky-feed/fail-new-identity
printf 'PASS rollback recovered from the exhausted real systemd start limit\n'


cat > /root/corgi-rehearsal-harness/fault.sh <<'FAULT'
set -Eeuo pipefail
source "$1"
fault="$2"
shift 2
set -T
trap 'if [[ "${FUNCNAME[0]:-}" == "apply_policy" || "${FUNCNAME[0]:-}" == "write_state" ]] && [[ "$BASH_COMMAND" == "$fault"* ]]; then kill -KILL "$BASHPID"; fi' DEBUG
apply_policy "$@"
FAULT
chmod 0600 /root/corgi-rehearsal-harness/fault.sh

# SIGKILL cannot run the EXIT trap. Exercise explicit recovery at migration boundaries.
# Match literal source commands; expanding these test patterns would invalidate fault injection.
# shellcheck disable=SC2016
for fault in \
  '/usr/bin/mv -f -- "$STATE_TMP" "$STATE_FILE"' \
  '/usr/sbin/groupadd --system' \
  "service_group_phase='created'" \
  "service_user_phase='created'" \
  '/usr/bin/install -o root -g root -m 0600 "$ENVIRONMENT_BACKUP" "$ENVIRONMENT_FILE"' \
  'assert_configuration_ancestors' \
  '/usr/bin/install -d -o root -g root -m 0755 "$DROPIN_DIR"' \
  '/usr/bin/install -o root -g root -m 0644 "$DROPIN_SNAPSHOT" "$DROPIN_PATH"' \
  '/usr/bin/install -o root -g root -m 0644 "$UNIT_SOURCE" "$UNIT_PATH"' \
  '/usr/bin/systemctl daemon-reload' \
  '/usr/bin/sync -f "$APPLICATION_DIR"' \
  'assert_runtime_identity' \
  '/usr/sbin/visudo -c ' \
  'verify_policy "$deploy_user"'; do
  systemctl reset-failed bluesky-feed
  if run_harness /root/corgi-rehearsal-harness/fault.sh "$provisioner" "$fault" deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_boundary_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION; then
    echo "FAIL fault injection did not interrupt: $fault" >&2; exit 1
  else
    status="$?"
    [[ "$status" == 137 ]] || { echo "Unexpected interruption status: $status" >&2; exit 1; }
  fi
  # This command is the first instruction after legacy removal.
  # shellcheck disable=SC2016
  if [[ "$fault" == '/usr/bin/sync -f "$APPLICATION_DIR"' ]]; then
    systemctl restart bluesky-feed
    systemctl is-active --quiet bluesky-feed
    [[ "$(systemctl show bluesky-feed --property=User --value)" == bluesky-feed ]]
    configuration_sha="$(sha256sum /etc/corgi/production.env | cut -d' ' -f1)"
    managed_sudoers_sha="$(sha256sum /etc/sudoers.d/corgi-deploy | cut -d' ' -f1)"
    managed_unit_sha="$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)"
    printf 'touch /etc/corgi-untrusted-rollback-ran\n' > "$provisioner"
    if rollback; then echo 'FAIL accepted corrupt rollback bootstrap' >&2; exit 1; fi
    assert_absent /etc/corgi-untrusted-rollback-ran
    [[ -d /var/lib/corgi-host-adoption ]]
    [[ "$(sha256sum /etc/corgi/production.env | cut -d' ' -f1)" == "$configuration_sha" ]]
    [[ "$(sha256sum /etc/sudoers.d/corgi-deploy | cut -d' ' -f1)" == "$managed_sudoers_sha" ]]
    [[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$managed_unit_sha" ]]
    runuser -u deploy-fixture -- git -C "$repo" show "$revision:ops/provision-corgi-host-identity.sh" > "$provisioner"
    printf 'PASS loaded unit starts after legacy removal; corrupt rollback bootstrap is rejected without policy mutation\n'
  fi
  rollback
  printf 'PASS SIGKILL recovery before %s\n' "$fault"
done
