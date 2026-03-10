#!/usr/bin/env bash
# Install ops scripts on the VPS
# Run from local: ssh root@64.23.239.212 'bash -s' < ops/install.sh
# Or from VPS:    cd /opt/bluesky-feed && bash ops/install.sh
set -euo pipefail

SCRIPTS="db redis logs deploy feed-check status"
for script in $SCRIPTS; do
  chmod +x "/opt/bluesky-feed/ops/$script"
  echo "✓ ops/$script"
done

echo ""
echo "Ops scripts installed. Usage from VPS:"
echo "  ops/db \"SELECT COUNT(*) FROM posts\""
echo "  ops/redis GET feed:count"
echo "  ops/logs -f"
echo "  ops/deploy"
echo "  ops/feed-check 50"
echo "  ops/status"
