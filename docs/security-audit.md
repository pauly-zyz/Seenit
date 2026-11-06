# Seenit MVP: self security review

Date: 2026-11-02. Scope: the whole monorepo at this commit: contracts, API (`apps/web`), worker, MCP server, SDK, dashboard and the mobile app logic. This is an internal review, **not** a substitute for a third-party audit (see `production-checklist.md`).

Method: route inventory (auth, rate limit, validation per endpoint), code reading of the trust boundaries, secret scanning of the tree and the full git history, `pnpm audit`, Foundry tests and coverage, and the end-to-end rehearsal in `docs/e2e-report.md` (25/25), which runs the fraud scenarios against the real API, worker, MCP server and contracts.

## Summary

| ID  | Area          | Finding                                                                                                                                                                                                                                                | Severity | Status                                                                                                                              |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Rate limiting | Client IP was taken from the **first** `X-Forwarded-For` entry, which the client controls: rotating it bypassed every per-IP limit (nonce, SIWE verify, nearby, Self callback)                                                                         | Medium   | **Fixed**: `x-real-ip`, else the right-most XFF hop (`clientIp` in `server/route.ts`)                                               |
| S-2 | Rate limiting | 8 endpoints had no limit (logout ×2, API key list/revoke, `funder/me`, webhook GET/DELETE, cron)                                                                                                                                                       | Low      | **Fixed**: `route()` applies `DEFAULT_RATE_LIMIT` (120/min) when a route sets none                                                  |
| S-3 | Integration   | `POST /missions/:id/confirm` returns `{ mission }`, but `seenit-sdk` and the dashboard read it as the mission itself. After a successful on-chain funding the MCP `confirm_mission` tool crashed and the dashboard redirected to `/missions/undefined` | Medium   | **Fixed** in the SDK and the dashboard, with tests; found by the E2E run                                                            |
| S-4 | Abuse         | Expired SIWE nonces were never deleted (public endpoint, unbounded table growth)                                                                                                                                                                       | Low      | **Fixed**: opportunistic cleanup in `issueNonce`                                                                                    |
| S-5 | Web hardening | No security headers; API responses cacheable                                                                                                                                                                                                           | Low      | **Fixed**: `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, HSTS, `Permissions-Policy`; `Cache-Control: no-store` on `/api/*` |
| S-6 | Dependencies  | 28 advisories (11 high), all transitive                                                                                                                                                                                                                | High→Low | **Partly fixed**: pnpm overrides for underscore, ws, follow-redirects, node-forge (28 → 12). Remaining highs below                  |
| S-7 | Storage       | R2 client sent the SDK's default flexible checksums (not supported by R2 on every operation)                                                                                                                                                           | Low      | **Fixed**: checksums only when required                                                                                             |

No secret was found in the tree or the history (only `.env.example` files are tracked; no private keys, cloud keys or API tokens). The private keys that appear in tests are anvil's public, well-known test keys.

## Details

### Secrets

- `.gitignore` excludes `.env*` (except examples), keys, keystores, `deployments/local/` and Foundry broadcasts.
- Scan of tree and history for PEM keys, AWS keys, Anthropic/Slack/GitHub tokens, Stripe-style keys, `*_PRIVATE_KEY=0x…` and 32-byte hex literals: nothing.
- Client bundles: only `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` values reach the browser/app, and none of them is a secret (chain id, RPC, explorer, Reown project id, map tiles).
- Stored secrets: session tokens and API keys are stored as SHA-256 only; webhook secrets and dispute archives are AES-256-GCM envelope-encrypted with `MEDIA_ENCRYPTION_KEYS`, bound to their record (AAD).

**Open:** the operator and attester keys are raw private keys in env vars. Before mainnet they should live in a KMS / managed signer (separate per role), see the checklist.

### Input validation

- Every body goes through a Zod schema in `route()`. Invalid JSON → 400; schema errors → 400 with field details. Route params that are UUIDs are checked before hitting Postgres.
- Mission specs: bounded strings, radius 10–5000 m, reward `uint128`-safe integer string, captures ≤ 1000, deadline 10 min–90 days, output schema restricted to a safe JSON Schema subset (`checkOutputSchema`: no `$ref`, closed objects, depth/size limits).
- Uploads: content type allow-list per media type and a max size, both signed into the upload URL; GPS bounds, accuracy ≤ 50 m and `isMocked` refused; capture metadata re-checked at finalize (`checkCapture`: radius, accuracy, fix skew, clock skew, capture age, video length); SHA-256 recomputed from storage and compared to the declared hash, then anchored on-chain.
- Reject reasons limited to 32 bytes (stored on-chain as `bytes32`). CSV exports neutralize spreadsheet formulas.
- SQL: Drizzle query builder / parameterized `sql` templates only.
- AI output: structured output + Zod validation against the funder's own schema; image text is treated as data in the prompt; uncertain results go to `needs_review` and the funder still decides.

### Authorization

| Principal          | How                                                                                                               | Scope checks                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Contributor        | SIWE session (Bearer token; httpOnly cookie also set)                                                             | Every query filtered by `auth.user` (missions access by tier, own submissions only)                                           |
| Funder (agent)     | API key (`x-api-key`, SHA-256 at rest, revocable)                                                                 | Every mission / submission lookup goes through `getFunderMission` / `loadFunderSubmission` (404 for other funders: E2E check) |
| Funder (dashboard) | SIWE → `seenit_funder_session` cookie (httpOnly, Secure, SameSite=Strict) + `x-seenit-csrf: 1` required on writes | Same funder scoping; API keys can be managed only with the session, never with an API key                                     |
| Cron               | `Authorization: Bearer $CRON_SECRET` (constant-time compare)                                                      | Indexer only                                                                                                                  |
| Self callback      | No auth; the ZK proof itself is verified with `SelfBackendVerifier`                                               | Session id + user binding in the proof                                                                                        |

On-chain, the contracts enforce the same rules independently: only `OPERATOR_ROLE` records/resolves, only the funder or operator accepts/rejects, only verified wallets can be recorded (`NotVerified`), one nullifier per wallet forever (`NullifierBoundToOtherWallet`), each submission resolves once (`NotPending`). The E2E run calls the contracts directly to prove these hold even if the API is bypassed.

**Fixed (with the contributor web app):** contributor endpoints accept the session cookie only with the `x-seenit-csrf: 1` header on writes, like the funder dashboard (`route.ts`, tested in `auth.test.ts`). The mobile app keeps using the Bearer token.

### Rate limiting

- Postgres fixed-window counters, keyed by principal (user / funder) or by client IP when anonymous; 429 with `Retry-After`. Every route now has a limit (S-2) and the IP can't be spoofed through XFF (S-1).
- Deploy behind a proxy that sets `x-real-ip` (Vercel does). If another proxy is used, make sure it overwrites `x-real-ip` / appends to XFF.
- At higher traffic, move counters to Redis (see checklist): the current design costs one DB write per request.

### Signed URLs (R2)

- Upload: `PUT` presigned for 10 minutes, signing `content-type` and `content-length`; the object key is server-chosen (`submissions/<mission>/<submission>/original`). The E2E run shows a changed type or size is refused with 403, and the emulator also refuses expired URLs.
- Download: only the blurred copies (`blurred/<submission>/frame-N.jpg`) are ever presigned, for 15 minutes. The original is never presigned: it is deleted after processing and kept only encrypted in `disputes/` for the retention period.
- The bucket must stay private (no public access, no public dev URL), with CORS limited to `PUT` from the app if a browser ever uploads.

### Webhooks

- HMAC-SHA256 with timestamp; https only; private/loopback/link-local targets refused, also after DNS resolution; no redirects; 10 s timeout.
- **Open (low):** there is a small time-of-check/time-of-use gap between the DNS check and the connection (DNS rebinding). Pin the resolved IP in the HTTP agent before opening webhooks to many funders.

### Smart contracts

- 95 Foundry tests (unit, fuzz, invariant, reentrancy attacks), 100% line/statement/branch/function coverage on `src/`.
- CEI + `nonReentrant` + `SafeERC20`, fee-on-transfer tokens refused, fee capped at 10% and snapshotted per mission, pause blocks only new activity (cancel/refund/finalize always work), 2-step admin transfer with delay, no upgradeability.
- Not done: static analysis (Slither/Aderyn), formal verification, external audit.

### Dependencies (after overrides)

12 advisories remain (2 high, 8 moderate, 2 low):

- `snarkjs` (high, no patched version) and `elliptic` (low) come from `@selfxyz/common` → `@selfxyz/anon-aadhaar-core` → `@zk-email/helpers`, code paths Seenit never calls (it uses `SelfAppBuilder` / `getUniversalLink` only). Track Self releases; consider importing only the submodules used.
- `zod@3.25` (high, fixed only in v4) is inside `expo` → `@expo/cli`: build tooling, not shipped in the app.
- Moderates: `uuid`, `minimatch`, `glob` in dev/build tooling.

Run `pnpm audit --prod` in CI and review on each dependency update.

### Privacy

- Faces and plates are blurred before anything is stored for funders or sent for answer extraction; if detection is unavailable nothing is published. Detection currently uses Claude (approximate boxes): use a dedicated detector before scale, and spot-check.
- Passport data is never requested from Self; only nullifier hashes and non-personal summaries are stored.
- **Open:** blurred frames are kept indefinitely, and uploads that failed the precheck are never cleaned up. Define retention for both.
