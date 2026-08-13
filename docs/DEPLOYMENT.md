# Deployment Guide

This guide is for deploying your own instance of Corgi, a community-governed Bluesky feed, on a VPS.

## Prerequisites

- Ubuntu 22.04+ VPS with at least 2GB RAM
- A domain pointed to your VPS
- A Bluesky account for feed publishing/admin
- `sudo` access on the server

## 1. Create/prepare Bluesky account

1. Create or choose the account that will publish the feed (for example `my-feed.bsky.social`).
2. Create an app password in Bluesky settings.
3. Resolve its DID:

```bash
set -euo pipefail
curl -fsS "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=my-feed.bsky.social"
```

Do not continue unless the command exits successfully. The `-f` flag makes an
HTTP 4xx or 5xx response fail instead of presenting an error body as a DID.
Save the returned `did`.

## 2. Install system dependencies

```bash
set -euo pipefail
sudo apt update && sudo apt upgrade -y
sudo apt install -y acl curl git jq nginx certbot python3-certbot-nginx redis-server postgresql
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Create PostgreSQL database

```bash
set -euo pipefail
sudo -u postgres psql --set ON_ERROR_STOP=1 <<'SQL'
CREATE USER feeduser WITH PASSWORD 'replace-with-strong-password';
CREATE DATABASE community_feed OWNER feeduser;
SQL
if ! ROLE_EXISTS="$(sudo -u postgres psql --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'feeduser'")"; then
  printf 'Unable to verify PostgreSQL role feeduser\n' >&2
  exit 1
fi
test "$ROLE_EXISTS" = "1"
if ! DATABASE_EXISTS="$(sudo -u postgres psql --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname = 'community_feed'")"; then
  printf 'Unable to verify PostgreSQL database community_feed\n' >&2
  exit 1
fi
test "$DATABASE_EXISTS" = "1"
```

## 4. Clone repository

```bash
set -euo pipefail
cd /opt
sudo git clone https://github.com/andrewnordstrom-eng/corgi.git /opt/bluesky-feed
DEPLOY_USER="$(id -un)"
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
sudo chown -R "$DEPLOY_USER":"$DEPLOY_GROUP" /opt/bluesky-feed
cd /opt/bluesky-feed
```

Keep the checkout and its `.git` directory owned by the deployment operator.
That same operator must be able to run the recurring `git pull`, dependency
install, build, test, and migration commands without `sudo`.

## 5. Configure environment

```bash
set -euo pipefail
cp .env.example .env
```

Edit `.env` and set required values:

- `DATABASE_URL`
- `REDIS_URL`
- `FEEDGEN_HOSTNAME`
- `BSKY_IDENTIFIER`
- `BSKY_APP_PASSWORD`
- `BOT_ADMIN_DIDS`

Recommended security defaults:

- `CORS_ALLOWED_ORIGINS` should be explicit for your production UI origin(s)
- `TRUST_PROXY` should match your reverse-proxy topology (typical single-host Nginx: `loopback`)
- `GOVERNANCE_SESSION_COOKIE_SAME_SITE=lax` (or `strict` if your deployment allows)

### DID bootstrap

Resolve and print `.env` DID values:

```bash
set -euo pipefail
npm run generate-feed-did -- my-feed.bsky.social
```

Then copy the printed `FEEDGEN_SERVICE_DID` and `FEEDGEN_PUBLISHER_DID` into `.env`.

## 6. Install dependencies and build

```bash
set -euo pipefail
npm install
npm --prefix web-next install
npm --prefix web install
npm run verify
```

## 7. Run migrations

```bash
set -euo pipefail
npm run migrate
```

## 8. Publish feed record to Bluesky

```bash
set -euo pipefail
npm run publish-feed
```

This creates/updates the `app.bsky.feed.generator/community-gov` record.

## 9. Configure systemd

Keep builds owned by the non-root deployment operator, but run the service as a
separate, read-only runtime identity. Resolve the operator identity and create
the runtime account only when it does not already exist:

```bash
set -euo pipefail
DEPLOY_USER="$(id -un)"
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
test "$DEPLOY_USER" != "root"
test "$(stat -c '%U' /opt/bluesky-feed)" = "$DEPLOY_USER"
test "$(stat -c '%G' /opt/bluesky-feed)" = "$DEPLOY_GROUP"
test -w /opt/bluesky-feed/.git
for OPERATOR_PATH in .git node_modules dist web/dist web-next/out; do
  test -e "/opt/bluesky-feed/$OPERATOR_PATH"
  if ! OWNER_MISMATCH="$(sudo find "/opt/bluesky-feed/$OPERATOR_PATH" \( ! -user "$DEPLOY_USER" -o ! -group "$DEPLOY_GROUP" \) -print -quit)"; then
    printf 'Unable to validate ownership for %s\n' "$OPERATOR_PATH" >&2
    exit 1
  fi
  if [ -n "$OWNER_MISMATCH" ]; then
    printf 'Deployment operator does not own %s: %s\n' "$OPERATOR_PATH" "$OWNER_MISMATCH" >&2
    exit 1
  fi
done
if ! getent group corgi-runtime > /dev/null; then
  sudo groupadd --system corgi-runtime
fi
if ! getent passwd corgi-runtime > /dev/null; then
  sudo useradd --system --gid corgi-runtime --home-dir /nonexistent --shell /usr/sbin/nologin corgi-runtime
fi
getent passwd corgi-runtime | awk -F: '$1 == "corgi-runtime" && $6 == "/nonexistent" && $7 == "/usr/sbin/nologin" { found=1 } END { exit !found }'
test "$(id -gn corgi-runtime)" = "corgi-runtime"
RUNTIME_GID="$(getent group corgi-runtime | awk -F: '{ print $3 }')"
test -n "$RUNTIME_GID"
RUNTIME_UID="$(id -u corgi-runtime)"
RUNTIME_PRIMARY_GID="$(id -g corgi-runtime)"
RUNTIME_GROUP_IDS="$(id -G corgi-runtime)"
test "$RUNTIME_UID" -ne 0
test "$RUNTIME_PRIMARY_GID" -ne 0
test "$RUNTIME_PRIMARY_GID" = "$RUNTIME_GID"
test "$RUNTIME_GROUP_IDS" = "$RUNTIME_PRIMARY_GID"
test -z "$(getent group corgi-runtime | awk -F: '$4 != "" { print $4 }')"
test -z "$(getent passwd | awk -F: -v gid="$RUNTIME_GID" '$4 == gid && $1 != "corgi-runtime" { print $1 }')"
```

After the initial dependency install and build, grant the runtime group read and
traverse access only to the files the running service needs. Setgid directories
and default ACLs preserve that read-only access for artifacts created by later
deploys, without requiring the runtime identity to own or write the checkout.
The `.env` file remains writable by the deployment operator because the deploy
workflow backs it up and restores it during tests.

Run the install, build, migration, and recurring pull commands in this guide
from the deployment operator's login session, without `sudo`. The ownership
gate above rejects root-owned or otherwise foreign build and Git artifacts
before runtime ACLs are applied.

```bash
set -euo pipefail
cd /opt/bluesky-feed
DEPLOY_USER="$(id -un)"
sudo chgrp corgi-runtime /opt/bluesky-feed /opt/bluesky-feed/web /opt/bluesky-feed/web-next
sudo chmod g+s,g+rx,g-w,o-rwx /opt/bluesky-feed /opt/bluesky-feed/web /opt/bluesky-feed/web-next
sudo setfacl -m d:g:corgi-runtime:r-x,d:m::r-x,d:o::--- /opt/bluesky-feed /opt/bluesky-feed/web /opt/bluesky-feed/web-next
for RUNTIME_PATH in dist node_modules web/dist web-next/out legal; do
  test -e "$RUNTIME_PATH"
  sudo chgrp -R corgi-runtime "$RUNTIME_PATH"
  sudo chmod -R g+rX,g-w,o-rwx "$RUNTIME_PATH"
  sudo find "$RUNTIME_PATH" -type d -exec chmod g+s {} +
  sudo find "$RUNTIME_PATH" -type d -exec setfacl -m d:g:corgi-runtime:r-x,d:m::r-x,d:o::--- {} +
done
sudo chgrp corgi-runtime package.json .env
sudo chmod g+r,g-w,o-rwx package.json
sudo chown "$DEPLOY_USER":corgi-runtime .env
sudo chmod 640 .env
sudo chmod -R go-rwx .git
sudo -u corgi-runtime test -r dist/index.js
sudo -u corgi-runtime test -r node_modules
sudo -u corgi-runtime test -r web/dist
sudo -u corgi-runtime test -r legal/TERMS_OF_SERVICE.md
sudo -u corgi-runtime test -r .env
sudo -u corgi-runtime test ! -w /opt/bluesky-feed
sudo -u corgi-runtime test ! -w /opt/bluesky-feed/.git
sudo -u corgi-runtime test ! -r /opt/bluesky-feed/.git/objects
if ! WRITABLE_RUNTIME_PATH="$(sudo -u corgi-runtime find /opt/bluesky-feed -xdev -path /opt/bluesky-feed/.git -prune -o -writable -print -quit)"; then
  printf 'Unable to validate runtime write access\n' >&2
  exit 1
fi
test -z "$WRITABLE_RUNTIME_PATH"
for RUNTIME_PATH in dist node_modules web/dist web-next/out legal; do
  if ! GROUP_WRITABLE_PATH="$(sudo find "$RUNTIME_PATH" -perm /022 -print -quit)"; then
    printf 'Unable to validate permissions for %s\n' "$RUNTIME_PATH" >&2
    exit 1
  fi
  test -z "$GROUP_WRITABLE_PATH"
done
```

Existing installations whose unit still runs without a dedicated `User=`
should schedule this as a service-hardening migration and verify a complete
build, migration, restart, and health check before switching the unit, rather
than changing its runtime identity during an ordinary deploy.

Create `/etc/systemd/system/bluesky-feed.service`:

```ini
[Unit]
Description=Corgi feed generator
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=corgi-runtime
Group=corgi-runtime
WorkingDirectory=/opt/bluesky-feed
Environment=NODE_ENV=production
EnvironmentFile=/opt/bluesky-feed/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable/start:

```bash
set -euo pipefail
sudo systemctl daemon-reload
sudo systemctl enable bluesky-feed
sudo systemctl start bluesky-feed
sudo systemctl status bluesky-feed
```

## 10. Configure Nginx + TLS

Create `/etc/nginx/sites-available/bluesky-feed`:

```nginx
server {
    listen 80;
    server_name feed.yourdomain.com;

    location / {
        # Match FEEDGEN_PORT from your .env
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and validate:

```bash
set -euo pipefail
sudo ln -sf /etc/nginx/sites-available/bluesky-feed /etc/nginx/sites-enabled/bluesky-feed
sudo nginx -t
sudo systemctl reload nginx
```

Issue certificate:

```bash
set -euo pipefail
sudo certbot --nginx -d feed.yourdomain.com
```

After enabling Nginx, confirm the app is not directly exposed on `FEEDGEN_PORT` from the internet and relies on trusted proxy headers only.

## 11. Verify deployment

```bash
set -euo pipefail
curl -f https://feed.yourdomain.com/health
curl -f "https://feed.yourdomain.com/xrpc/app.bsky.feed.describeFeedGenerator"
```

Also verify logs:

```bash
set -euo pipefail
sudo journalctl -u bluesky-feed -f
```

## 12. Admin access

- Log in on the web UI with the Bluesky account.
- Ensure that account DID is included in `BOT_ADMIN_DIDS`.
- Restart service after `.env` changes:

```bash
set -euo pipefail
sudo systemctl restart bluesky-feed
```

## 13. Optional: public docs subdomain (`docs.corgi.network`)

This repository includes a dedicated docs deployment workflow:

- Workflow: `.github/workflows/deploy-docs.yml`
- Source artifacts: `docs/docs-site/index.html` and `docs/docs-site/openapi.json`
- VPS target directory: `/var/www/corgi-docs`

Expected Nginx location:

```nginx
location / {
    root /var/www/corgi-docs;
    index index.html;
    try_files $uri $uri/ /index.html;
}
```

Required GitHub Actions secrets:

- Add these as repository-level secrets in the canonical repository:
  `Settings -> Secrets and variables -> Actions` for
  `andrewnordstrom-eng/corgi`.
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_SSH_HOST_KEY` (required by `daily-health.yml`; also pins the host for
  `deploy-docs.yml` and `weekly-export.yml` instead of their compatibility
  bootstrap behavior; `deploy.yml` currently delegates SSH setup to its pinned
  SSH action and does not consume this secret)
- `DATABASE_URL` (required by `daily-health.yml` and `weekly-export.yml`)
- `EXPORT_ANONYMIZATION_SALT` (required by `weekly-export.yml`)
- `HEALTHCHECK_PING_URL` (optional, used by deploy and daily health monitor pings)

On each `main` push that changes `docs/docs-site/**`, the workflow uploads the docs bundle to the VPS and verifies that live `https://docs.corgi.network/` and `/openapi.json` hashes match the repository artifacts.

## Operations checklist

- Keep ports `5432` and `6379` private.
- Only expose `80/443`.
- Rotate app passwords and admin DID list as needed.
- Watch `/health` and systemd logs.
- Use `docs/OPS_RUNBOOK.md` for day-2 operations, retention, alerting, and incident response.
- After any repository rename or ownership transfer, run the "Post-Rename or Transfer Validation (Manual Dispatch)" section in `docs/OPS_RUNBOOK.md`.
