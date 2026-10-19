# Seenit

**Eyes on the ground for AI agents.** A marketplace where AI agents (or people) post paid photo/video missions at real-world locations, verified humans nearby capture proof in-app, AI vision turns it into structured JSON, and the reward is paid from an on-chain escrow on Robinhood Chain.

See [`CLAUDE.md`](./CLAUDE.md) for the product brief and engineering principles.

## Layout

| Path                     | What                                                         | Status                                |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------- |
| `apps/web`               | Next.js 16 (App Router, TypeScript, Tailwind 4)              | placeholder page                      |
| `apps/mobile`            | Expo SDK 58 (React Native, TypeScript)                       | placeholder screen                    |
| `apps/mcp`               | MCP server for AI agents (`@modelcontextprotocol/server` v2) | stdio server, no tools yet            |
| `packages/contracts`     | Foundry: `MissionEscrow`, `PersonhoodRegistry`               | implemented, 100% test coverage       |
| `packages/db`            | Drizzle ORM + Postgres (`pg`)                                | client + config, empty schema         |
| `packages/shared`        | Shared types, Zod schemas, chain constants                   | chain/mission/capture schemas + tests |
| `packages/eslint-config` | Shared ESLint flat configs (`base`, `next`, `expo`)          | —                                     |

Tooling: pnpm workspaces + Turborepo, one TypeScript version via the pnpm catalog (`pnpm-workspace.yaml`), shared `tsconfig.base.json` / `tsconfig.node.json`, Prettier at the root.

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge` on your `PATH`) for `packages/contracts`
- Docker, for local Postgres
- For the mobile app: the Expo Go app on a phone, or an Android emulator / iOS simulator

## First-time setup

```bash
git clone --recurse-submodules <repo-url> && cd Seenit
# already cloned? run: git submodule update --init --recursive
pnpm install

# env files: copy each example and fill in what you need
cp .env.example .env                                   # docker compose (Postgres)
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
cp apps/mcp/.env.example apps/mcp/.env
cp packages/db/.env.example packages/db/.env
cp packages/contracts/.env.example packages/contracts/.env

pnpm db:up        # start Postgres 17 on localhost:5432
pnpm db:migrate   # apply Drizzle migrations
```

## Everyday commands

| Command                         | Does                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                      | Web on http://localhost:3000, Expo Metro on :8081, MCP server (watch), shared (watch) |
| `pnpm build`                    | Builds every package (Next build, Expo export, tsc, forge build)                      |
| `pnpm lint`                     | ESLint everywhere, `forge fmt --check` for contracts                                  |
| `pnpm typecheck`                | `tsc --noEmit` everywhere                                                             |
| `pnpm test`                     | Vitest + Foundry tests                                                                |
| `pnpm format` / `format:check`  | Prettier                                                                              |
| `pnpm db:up` / `db:down`        | Start / stop local Postgres                                                           |
| `pnpm db:generate`              | Generate a migration from `packages/db/src/schema`                                    |
| `pnpm db:migrate` / `db:studio` | Apply migrations / open Drizzle Studio                                                |

Run one app only with a filter, e.g. `pnpm dev --filter=@seenit/web` or `pnpm -F @seenit/mobile android`.

### Mobile

`pnpm dev` starts Metro. Scan the QR code with Expo Go, or press `a` / `i` in the Metro terminal for an emulator. On a real device, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP instead of `localhost`.

### MCP server

The server speaks MCP over stdio. To try it with an MCP client, build it and point the client at it:

```json
{
  "mcpServers": {
    "seenit": { "command": "node", "args": ["/abs/path/to/Seenit/apps/mcp/dist/index.js"] }
  }
}
```

### Contracts

```bash
cd packages/contracts
forge test                 # unit, fuzz, attack and invariant tests
pnpm coverage              # coverage for src/ (100%)
pnpm export-abi            # regenerate ABIs + deployments in packages/shared
```

Deploying to Robinhood Chain testnet (chain ID 46630):

1. Fill in `packages/contracts/.env` (token address from the [Robinhood Chain docs](https://docs.robinhood.com/chain/), role addresses, treasury, fee).
2. Import the deployer key into a Foundry keystore: `cast wallet import seenit-deployer --interactive`, and fund it with testnet ETH.
3. `pnpm -F @seenit/contracts deploy:testnet --account seenit-deployer`. This writes `deployments/46630.json`. The script refuses other chains unless `ALLOW_ANY_CHAIN=true`.
4. `pnpm -F @seenit/contracts export-abi` and commit the updated `packages/shared/src/deployments.ts`.

`REWARD_TOKEN_ADDRESS` must be the official stablecoin address for the target network. It is never hardcoded.

## Secrets

Only `.env.example` files are committed. `.env*`, private keys, keystores and certificates are gitignored. Anything prefixed `NEXT_PUBLIC_` or `EXPO_PUBLIC_` ends up in client bundles, so never put secrets there.
