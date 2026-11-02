# Seenit MCP server

Lets AI agents send verified people to real places to take photos or videos, and get structured JSON answers back. Rewards are paid in stablecoins from an on-chain escrow on Robinhood Chain.

Built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Supports **stdio** (Claude Desktop, Claude Code and other local clients) and **Streamable HTTP**. It calls the Seenit REST API with a funder API key through [`seenit-sdk`](../../packages/sdk).

## Tools

| Tool                                                                                                                                                                          | What it does                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `list_templates()`                                                                                                                                                            | Ready-made answer formats: `stock_check`, `store_open`, `construction_progress`, `billboard_proof`, `crowd_level` |
| `create_mission(title, instructions, media_type, lat, lng, radius_m, reward_per_capture, max_captures, deadline, template \| output_schema, [max_video_seconds], [min_tier])` | Saves an **unfunded draft** and returns a summary with the total cost. Nothing is live and no money moves         |
| `confirm_mission(mission_id, [tx_hash], [user_confirmed])`                                                                                                                    | Funds the escrow; the mission goes live                                                                           |
| `get_mission_status(mission_id)`                                                                                                                                              | Status, slots left, submissions per status, payouts                                                               |
| `get_results(mission_id, [include_pending])`                                                                                                                                  | Structured answers + short-lived links to the face/plate-blurred media + on-chain proof                           |
| `cancel_mission(mission_id, [tx_hash], [user_confirmed])`                                                                                                                     | Closes a draft, or cancels a live mission and refunds unused slots                                                |

`reward_per_capture` is in token units (`"2.5"` = 2.5 USDG). `deadline` is ISO 8601 with a timezone.

### Funding needs the user's approval

`create_mission` only saves a draft. The agent must show the summary (total escrow, reward, area, deadline) and get the user's explicit yes before calling `confirm_mission`. The server enforces this:

- **Clients that support elicitation** get a confirmation prompt from the server itself ("Fund the Seenit mission … with 6.00 USDG?"). The model can't answer it for the user. Declining stops the call.
- **Clients without elicitation**: `confirm_mission` and `cancel_mission` refuse until they are called again with `user_confirmed: true`, which the tool description reserves for an explicit approval in the conversation.
- `SEENIT_MAX_SPEND` caps the escrow per mission the server will sign.
- Tool annotations mark `confirm_mission` and `cancel_mission` as destructive, so clients can ask before running them.

### Two ways to pay

1. **The user's own wallet (default).** `confirm_mission` returns the two transactions (`approve`, `createMission`) to sign on Robinhood Chain. After they are mined, call `confirm_mission` again with `tx_hash`. Cancelling a live mission works the same way.
2. **A funder wallet on this server.** Set `SEENIT_FUNDER_PRIVATE_KEY`. After approval, the server checks each transaction the API returned (token, escrow, amount, spec hash, chain), signs, waits for the receipt and confirms with the API. Use a dedicated wallet holding only what agents may spend, plus `SEENIT_MAX_SPEND`.

## Setup

```bash
pnpm install
pnpm -F seenit-sdk build
pnpm -F @seenit/mcp build          # → apps/mcp/dist/index.js (bin: seenit-mcp)
cp apps/mcp/.env.example apps/mcp/.env   # only used by `pnpm start` / `start:http`
```

| Variable                         |                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `SEENIT_API_URL`                 | Seenit API origin, e.g. `https://api.seenit.xyz` or `http://localhost:3000`               |
| `SEENIT_API_KEY`                 | Funder API key (`sk_...`)                                                                 |
| `SEENIT_FUNDER_PRIVATE_KEY`      | Optional: let the server sign funding/cancel transactions                                 |
| `SEENIT_RPC_URL`                 | Optional RPC for that wallet (default: public RPC from the official Robinhood Chain docs) |
| `SEENIT_MAX_SPEND`               | Optional cap per mission, token units                                                     |
| `MCP_HTTP_HOST`, `MCP_HTTP_PORT` | HTTP transport bind (default `127.0.0.1:8787`)                                            |
| `MCP_HTTP_TOKEN`                 | Bearer token for `/mcp`. Required when not bound to localhost                             |
| `MCP_HTTP_ALLOWED_HOSTS`         | Hostnames accepted in Host/Origin when not on localhost                                   |

## Claude Code

stdio (the client starts the server):

```bash
claude mcp add --transport stdio \
  -e SEENIT_API_URL=https://api.seenit.xyz \
  -e SEENIT_API_KEY=sk_your_key \
  seenit -- node /absolute/path/to/Seenit/apps/mcp/dist/index.js
```

Add `--scope project` to share it through `.mcp.json`, or `--scope user` for all your projects. Everything after `--` is passed to the server untouched.

Streamable HTTP (server already running with `pnpm -F @seenit/mcp start:http`):

```bash
claude mcp add --transport http seenit http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer your-mcp-http-token"
```

Project `.mcp.json` (Claude Code expands `${VAR}` and `${VAR:-default}`, so keys stay out of the file):

```json
{
  "mcpServers": {
    "seenit": {
      "command": "node",
      "args": ["/absolute/path/to/Seenit/apps/mcp/dist/index.js"],
      "env": {
        "SEENIT_API_URL": "${SEENIT_API_URL:-http://localhost:3000}",
        "SEENIT_API_KEY": "${SEENIT_API_KEY}"
      }
    },
    "seenit-http": {
      "type": "http",
      "url": "${SEENIT_MCP_URL:-http://127.0.0.1:8787/mcp}",
      "headers": { "Authorization": "Bearer ${SEENIT_MCP_TOKEN}" }
    }
  }
}
```

## Claude Desktop

Add the server to `claude_desktop_config.json` (Settings → Developer → Edit Config; on macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows `%APPDATA%\Claude\claude_desktop_config.json`), then quit and reopen the app:

```json
{
  "mcpServers": {
    "seenit": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/Seenit/apps/mcp/dist/index.js"],
      "env": {
        "SEENIT_API_URL": "https://api.seenit.xyz",
        "SEENIT_API_KEY": "sk_your_key"
      }
    }
  }
}
```

Use absolute paths: the app may start with a minimal `PATH`. For a remote HTTP deployment, add it as a custom connector in the app's settings instead.

## HTTP transport

```bash
pnpm -F @seenit/mcp start:http     # http://127.0.0.1:8787/mcp, health at /health
```

- Stateless: each request gets a fresh server instance (`createMcpHandler`), so it scales horizontally.
- Serves both protocol eras (2026-07-28 and 2025 clients).
- Host and Origin headers are checked (DNS-rebinding protection). On localhost only local names are accepted; elsewhere, only `MCP_HTTP_ALLOWED_HOSTS`.
- `MCP_HTTP_TOKEN` protects `/mcp`. The server refuses to listen beyond localhost without a token and an allowed-hosts list. Put it behind TLS.
- One deployment = one funder account (the `SEENIT_API_KEY` in its env). Don't expose a server holding `SEENIT_FUNDER_PRIVATE_KEY` to people who shouldn't spend from that wallet.

## Example conversation

> **User:** Is Luna Bakery near Monas open right now? Spend at most 5 USDG.
>
> **Agent:** `create_mission` (template `store_open`, 1.5 USDG × 3, 100 m, deadline in 2 h) → "Draft saved… Total to escrow: 4.50 USDG." Asks: _"Fund 4.50 USDG for this mission?"_
>
> **User:** Yes.
>
> **Agent:** `confirm_mission` → (client shows the confirmation prompt) → "Funded 4.50 USDG. Mission is live." Later `get_results` → `{ "is_open": "open", "posted_hours": "07:00–21:00" }` with a link to the blurred photo.

## Development

```bash
pnpm -F @seenit/mcp dev            # stdio, watch mode
pnpm -F @seenit/mcp dev:http       # HTTP, watch mode
pnpm -F @seenit/mcp test           # in-process client tests (both eras, elicitation), HTTP and stdio transports
```

Tests use a fake Seenit API and a fake funder; they never touch a chain or the real API.
