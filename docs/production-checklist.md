# Seenit: deploy checklist

Three parts: deploying the contracts to Robinhood Chain testnet, running the stack in production, and what must be done before mainnet. The end-to-end rehearsal (`pnpm e2e`, report in `docs/e2e-report.md`) runs the same deploy script and flows against a local chain; run it before every deploy.

## 1. Robinhood Chain testnet deploy

Not done from the build environment: it needs a funded deployer key, and the official docs (for the stablecoin address) were not reachable from it. Steps:

- [ ] From the **official** Robinhood Chain docs (https://docs.robinhood.com/chain/), take the testnet RPC, explorer, and the stablecoin contract address and decimals (USDG or USDC). Never guess the address. Put the token in `packages/contracts/.env` as `REWARD_TOKEN_ADDRESS` and its symbol/decimals in `apps/web/.env.local` and `apps/mobile/.env` (`REWARD_TOKEN_SYMBOL/DECIMALS`, `EXPO_PUBLIC_REWARD_TOKEN_*`).
- [ ] Create wallets: deployer, admin (a Safe multisig if possible), attester, operator, pauser, treasury. Fund deployer, attester and operator with testnet ETH from the official faucet. The operator and attester pay gas for every record/accept/attest: keep them topped up.
- [ ] Fill `packages/contracts/.env` (`ADMIN_ADDRESS`, `ATTESTER_ADDRESS`, `OPERATOR_ADDRESS`, `PAUSER_ADDRESS`, `TREASURY_ADDRESS`, `PLATFORM_FEE_BPS`, `TIER1_MAX_REWARD`, `REVIEW_WINDOW_SECONDS`). `TIER1_MAX_REWARD` must equal the API's value.
- [ ] Import the deployer into a Foundry keystore (no raw key on disk): `cast wallet import seenit-deployer --interactive`.
- [ ] Deploy (the script refuses any chain other than 46630):
  ```bash
  cd packages/contracts
  forge script script/Deploy.s.sol --rpc-url robinhood_testnet --account seenit-deployer --sender <deployer> --broadcast
  ```
  This writes `deployments/46630.json`.
- [ ] `pnpm -F @seenit/contracts export-abi` and commit `packages/shared/src/deployments.ts` + `deployments/46630.json`.
- [ ] `pnpm env:sync` writes the addresses and the start block into `apps/web/.env.local` and the chain id into `apps/mobile/.env` (the MCP server and SDK read them from `GET /api/meta`).
- [ ] Verify the contract sources on the explorer (follow the official docs for the verifier it supports).
- [ ] Smoke test: sign in on `/dashboard`, create a small mission, fund it, check `/api/meta` and the indexer (`/api/cron/indexer`).

## 2. Production services

### Web + API (Vercel)

- [ ] Vercel project with root directory `apps/web` (pnpm workspace detected; build `pnpm turbo run build --filter=@seenit/web`).
- [ ] All server env vars from `apps/web/.env.example` in the Production environment (database, chain, keys, R2, SIWE domain = the production host, `CRON_SECRET` ≥ 32 chars, Human Passport, Self, `MEDIA_ENCRYPTION_KEYS`). `WEBHOOK_ALLOW_HTTP=false`. Never put secrets in `NEXT_PUBLIC_*`.
- [ ] `apps/web/vercel.json` schedules `/api/cron/indexer` every minute; Vercel sends `Authorization: Bearer $CRON_SECRET`. Minute-level crons need a paid plan; otherwise run the indexer as a process (below).
- [ ] Self callback endpoint must be public https (`SELF_ENDPOINT`), and `SELF_MOCK_PASSPORT=false` in production.
- [ ] Custom domain + HTTPS; check the security headers (`next.config.ts`) and that `x-real-ip` reaches the app.
- [ ] Vercel functions open Postgres connections per instance: use the provider's pooled connection string.

### Worker and indexer (container host: Fly.io, Render, Railway, ECS, …)

The worker can't run on Vercel functions: it needs ffmpeg, local disk and long jobs.

- [ ] Image with Node 22, pnpm, `ffmpeg`/`ffprobe`; command `pnpm -F @seenit/web worker` (and `pnpm -F @seenit/web indexer` if not using the Vercel cron). Same env as the API plus `ANTHROPIC_API_KEY`, `AI_*`, `MEDIA_ENCRYPTION_KEYS`, `ORIGINAL_RETENTION_DAYS`.
- [ ] Scale horizontally as needed (jobs are claimed with `FOR UPDATE SKIP LOCKED`); `WORKER_CONCURRENCY` per instance; graceful shutdown on SIGTERM.
- [ ] Alert on jobs stuck in `failed` and on `needs_review` with reason `processing_failed`.

### MCP server

- [ ] stdio: users run `seenit-mcp` locally (Claude Desktop / Claude Code) with their own API key: publish `apps/mcp` (and `seenit-sdk`) to npm or ship a binary.
- [ ] Hosted HTTP (`seenit-mcp --http`): container behind TLS, `MCP_HTTP_TOKEN`, `MCP_HTTP_ALLOWED_HOSTS`, one deployment per funder account. Don't set `SEENIT_FUNDER_PRIVATE_KEY` on a shared deployment; if used, a dedicated low-balance wallet + `SEENIT_MAX_SPEND`.

### Postgres (managed: Neon, Supabase, RDS, Cloud SQL)

- [ ] Postgres 16+, TLS, pooled endpoint for Vercel and a direct one for the worker/migrations.
- [ ] Run migrations in the deploy pipeline (`packages/db/drizzle`) before the new API version starts.
- [ ] Point-in-time recovery + daily backups; restore drill.

### Redis (managed: Upstash, ElastiCache)

The MVP needs **no** Redis: the job queue, rate limits and indexer cursor live in Postgres. Add Redis when one of these happens:

- [ ] rate-limit writes become a noticeable share of DB load: move `enforceRateLimit` to Redis (same interface);
- [ ] job volume needs push-based queues (BullMQ): keep the Postgres queue as the source of truth or migrate the job types one by one.

### Storage (Cloudflare R2)

- [ ] Private bucket (no public bucket/dev URL); token scoped to that bucket with object read/write.
- [ ] CORS only if a browser uploads (`PUT` from the app origin); the mobile app uploads directly with presigned URLs.
- [ ] Lifecycle rule on `submissions/*/original` for uploads that were never processed (precheck failures) and a retention decision for `blurred/`.

### Mobile (EAS)

- [ ] `eas init` in `apps/mobile` (links the project; `eas.json` has development / preview / production profiles).
- [ ] EAS environment variables per environment: `EXPO_PUBLIC_API_URL` (production API), chain id, RPC, explorer, token symbol/decimals, `EXPO_PUBLIC_REOWN_PROJECT_ID`, and the Google Maps keys (restricted to the app's package/bundle id).
- [ ] `eas build --profile production --platform all`, then `eas submit`. Store listing: explain camera + location use (in-app capture only).
- [ ] Reown AppKit: check the Community License terms for your volume before launch.

### Keys and access

- [ ] Operator and attester keys in a KMS / managed signer, separate per role and per environment; rotate if leaked (grant the new key the role, revoke the old one).
- [ ] Admin = multisig; pauser = on-call key or multisig.
- [ ] `MEDIA_ENCRYPTION_KEYS` in the secret manager; rotation = prepend a new key (old ones keep decrypting).
- [ ] Monitoring: API errors (request ids in logs), worker queue depth, operator/attester ETH balance, escrow token balance vs. sum of open missions, indexer lag.

## 3. Before mainnet

Blockers:

- [ ] **Third-party smart contract audit** of `MissionEscrow` and `PersonhoodRegistry` (plus the deploy script and role setup), all findings fixed and re-reviewed. Add Slither/Aderyn to CI before the audit.
- [ ] Bug bounty for contracts and API (scope + payout table).
- [ ] Mainnet addresses for chain, RPC and the stablecoin from the official docs; add the mainnet chain to `packages/shared` (from the docs, never guessed) and lift the testnet-only deploy guard deliberately.
- [ ] Admin multisig with timelock; documented pause/incident runbook; operator key in KMS; pauser on call.
- [ ] Device integrity for contributors: Play Integrity (Android) and App Attest (iOS) on upload, to back the in-app-camera and mock-location rules with attestation.
- [ ] A dedicated face/plate detection model (not only the LLM) with measured recall, plus human spot checks.
- [ ] Self (Tier 2) tested end to end with real passports; Human Passport scorer and threshold tuned for Sybil resistance.
- [ ] Legal: terms for funders and contributors, privacy policy (location, media, retention), contributor payouts and KYC/tax obligations per country, stablecoin regulatory review.
- [ ] Dispute process using the encrypted originals (who can decrypt, logging, retention).
- [ ] Load test (API, worker throughput, RPC limits) and a cost model for Claude per submission.
- [ ] Resolve the open items in `docs/security-audit.md` (contributor cookie CSRF, webhook DNS pinning, dependency advisories, retention).
- [ ] Re-run `pnpm e2e` and a manual testnet run on real devices; keep `docs/e2e-report.md` up to date.
