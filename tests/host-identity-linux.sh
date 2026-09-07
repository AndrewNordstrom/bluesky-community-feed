#!/bin/bash
set -Eeuo pipefail
[[ -f /.dockerenv && "${CORGI_DUMMY_REHEARSAL:-}" == 'CONFIRM-DISPOSABLE-CONTAINER' ]] || { echo 'Disposable container confirmation required' >&2; exit 1; }
[[ "$(id -u)" == 0 && -d /run/systemd/system ]] || { echo 'Isolated root and real systemd required' >&2; exit 1; }
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
# Only this synthetic repository is trusted by root inside the disposable container.
git config --global --add safe.directory "$repo"
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
if (process.getuid() !== fs.statSync('/opt/bluesky-feed').uid && fs.existsSync('/opt/bluesky-feed/fail-new-identity')) process.exit(43);
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
UNIT
sed -e 's/^User=bluesky-feed$/User=deploy-fixture/' -e 's/^Group=bluesky-feed$/Group=deploy-fixture/' -e 's@^EnvironmentFile=.*@EnvironmentFile=/opt/bluesky-feed/.env@' "$repo/ops/bluesky-feed.service" > /etc/systemd/system/bluesky-feed.service
chmod 0644 /etc/systemd/system/bluesky-feed.service
systemctl daemon-reload
systemctl start bluesky-feed
systemctl is-active --quiet bluesky-feed
printf 'PASS original fixture service active with actual systemd\n'
unit_sha="$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)"
sudoers_sha="$(sha256sum /etc/sudoers.d/fixture-deployment | cut -d' ' -f1)"
provisioner="$repo/ops/provision-corgi-host-identity.sh"
apply() {
  bash "$provisioner" apply deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION
}
rollback() {
  bash "$provisioner" rollback deploy-fixture CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK
  [[ "$(sha256sum /opt/bluesky-feed/.env | cut -d' ' -f1)" == "$legacy_sha" ]]
  [[ "$(stat -c '%U:%G:%a' /opt/bluesky-feed/.env)" == 'deploy-fixture:deploy-fixture:600' ]]
  [[ "$(sha256sum /etc/systemd/system/bluesky-feed.service | cut -d' ' -f1)" == "$unit_sha" ]]
  [[ ! -e /etc/corgi && ! -e /var/lib/corgi-host-adoption ]]
  systemctl is-active --quiet bluesky-feed
}
bash "$provisioner" preflight deploy-fixture /etc/sudoers.d/fixture-deployment
apply
bash "$provisioner" verify deploy-fixture
apply
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
# A later root-managed dispatcher replacement must survive a rejected rollback.
printf '\n# independently replaced fixture dispatcher\n' >> /usr/local/sbin/corgi-deploy-root
changed_wrapper_sha="$(sha256sum /usr/local/sbin/corgi-deploy-root | cut -d' ' -f1)"
if bash "$provisioner" rollback deploy-fixture CONFIRM-CORGI-HOST-IDENTITY-ROLLBACK; then
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
[[ ! -e /var/lib/corgi-host-adoption && ! -e /etc/corgi ]]
printf 'PASS failed service transition automatically restored original service and configuration\n'

cat > /fixture/fault.sh <<'FAULT'
set -Eeuo pipefail
source "$1"
fault="$2"
shift 2
set -T
trap 'if [[ "${FUNCNAME[0]:-}" == "apply_policy" || "${FUNCNAME[0]:-}" == "write_state" ]] && [[ "$BASH_COMMAND" == "$fault"* ]]; then kill -KILL "$BASHPID"; fi' DEBUG
apply_policy "$@"
FAULT

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
  '/usr/bin/install -o root -g root -m 0644 "$UNIT_SOURCE" "$UNIT_PATH"' \
  '/usr/bin/systemctl daemon-reload' \
  'assert_runtime_identity' \
  '/usr/sbin/visudo -c ' \
  'verify_policy "$deploy_user"'; do
  systemctl reset-failed bluesky-feed
  if CORGI_HOST_IDENTITY_LIBRARY_ONLY=1 bash /fixture/fault.sh "$provisioner" "$fault" deploy-fixture /etc/sudoers.d/fixture-deployment "$sudoers_sha" "$unit_sha" "$revision" CONFIRM-CORGI-HOST-IDENTITY-ADOPTION; then
    echo "FAIL fault injection did not interrupt: $fault" >&2; exit 1
  else
    status="$?"
    [[ "$status" == 137 ]] || { echo "Unexpected interruption status: $status" >&2; exit 1; }
  fi
  rollback
  printf 'PASS SIGKILL recovery before %s\n' "$fault"
done
