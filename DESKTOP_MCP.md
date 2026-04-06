# Desktop MCP Server Setup

Standalone stdio MCP server that gives the Claude Desktop app direct access to
feed operations via SSH to the VPS.

## Prerequisites

1. **SSH alias**: `~/.ssh/config` must have a `corgi-vps` host entry pointing to `64.23.239.212`.
2. **ops/ scripts installed on VPS**: `ssh corgi-vps 'ls /opt/bluesky-feed/ops/status'` should succeed.
3. **Node.js** installed locally.

## Build

```bash
npm run build:mcp-local
```

Output: `dist/mcp-local/server.js`

## Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "corgi-feed": {
      "command": "node",
      "args": [
        "/Users/andrewnordstrom/Desktop/Projects/Active/Bluesky_Corgi/dist/mcp-local/server.js"
      ]
    }
  }
}
```

Restart Claude Desktop. The MCP tools icon will appear in the chat input area.

## Available Tools

| Tool               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `feed_status`      | Service health, post counts, scoring timing, disk usage |
| `feed_audit`       | Audit top N posts with score breakdowns                 |
| `db_query`         | Read-only SQL queries (SELECT/WITH only)                |
| `governance_state` | Current epoch weights, vote count, status               |
| `service_logs`     | Recent logs with optional grep filtering                |
| `generate_report`  | Generate feed quality analysis report (docx)            |
| `redis_get`        | Fetch a Redis cache value                               |
| `deploy`           | Deploy latest main to VPS (requires confirmation)       |

## Verify

```bash
# Quick test — should output a JSON-RPC response with server capabilities
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}\n' \
  | node dist/mcp-local/server.js 2>/dev/null
```

## Architecture

```
Claude Desktop  ←stdin/stdout→  dist/mcp-local/server.js  ←SSH→  VPS ops/ scripts
                                          ↓
                                  scripts/generate-report.py (local)
```

This is separate from the embedded HTTP MCP server at `src/mcp/`. That server
runs inside Fastify with StreamableHTTP transport and session auth. This one is
a lightweight client-side companion for desktop use.

## Troubleshooting

- **No tools showing**: Check `claude_desktop_config.json` path is correct. Restart Claude Desktop.
- **SSH timeout**: Verify `ssh corgi-vps 'echo ok'` works from your terminal.
- **Build errors**: Run `npm run build:mcp-local` and check for TypeScript errors.
- **Report generation fails**: Ensure `python3` is available and report dependencies are installed.
