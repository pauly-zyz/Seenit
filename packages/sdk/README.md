# seenit-sdk

TypeScript client for the [Seenit](../../README.md) API: ask verified people to take a photo or video at a real place, get a structured JSON answer back, and pay them in stablecoins from an on-chain escrow.

- Zero runtime dependencies (uses `fetch`). Node 20+, Deno, Bun, edge runtimes.
- Typed responses and errors (`SeenitError` with `status`, `code`, `requestId`, `retryable`).
- Safe retries for reads (network errors, 429, 5xx); writes are never retried automatically.
- `seenit-sdk/viem`: optional helpers to fund or cancel a mission from your own wallet, checking every transaction before it is signed.
- Webhook signature verification.

## Install

```bash
npm install seenit-sdk
# only for the on-chain helpers:
npm install viem
```

## Quick start

```ts
import { formatAmount, parseUnits, Seenit } from "seenit-sdk";

const seenit = new Seenit({
  apiKey: process.env.SEENIT_API_KEY, // sk_...
  baseUrl: process.env.SEENIT_API_URL,
});
const { token } = await seenit.meta(); // { symbol: "USDG", decimals: 6, address }

// 1. Save a mission. It is a draft: nothing is live and no money moves yet.
const { mission, funding } = await seenit.missions.create({
  title: "Is Luna Bakery open right now?",
  instructions: "Photograph the entrance so the door and any posted notice are visible.",
  mediaType: "photo",
  location: { lat: -6.175392, lng: 106.827153 },
  radiusMeters: 100,
  rewardPerSubmission: parseUnits("2", token.decimals),
  maxSubmissions: 3,
  deadline: new Date(Date.now() + 6 * 3600_000),
  template: "store_open", // or outputSchema: { type: "object", properties: { ... } }
});
console.log(formatAmount(funding.total, token.decimals, token.symbol)); // "6.00 USDG"

// 2. Fund it: sign funding.transactions (approve, createMission) with the funder wallet, then
await seenit.missions.confirm(mission.id, createMissionTxHash);
//    ...or let the viem helper do both steps (below).

// 3. Read answers.
const status = await seenit.missions.status(mission.id);
const queue = await seenit.missions.submissions(mission.id, { status: "needs_review" });
const { results } = await seenit.missions.results(mission.id); // accepted answers + blurred media links
```

## API

| Method                                                      | What it does                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `meta()`                                                    | Chain id, escrow address, reward token (address, symbol, decimals), Tier 1 reward limit                           |
| `templates.list()` / `templates.get(id)`                    | Ready-made output schemas: `stock_check`, `store_open`, `construction_progress`, `billboard_proof`, `crowd_level` |
| `missions.create(input)`                                    | Saves a draft (`pending_funding`) and returns the funding transactions. `template` or `outputSchema`              |
| `missions.confirm(id, txHash)`                              | Activates the mission from its mined `createMission` transaction                                                  |
| `missions.status(id)`                                       | Status, slots, submissions by status, payouts, funding transactions while unfunded                                |
| `missions.submissions(id, { status? })`                     | Review queue: AI answer, confidence, reasoning, review reasons, blurred frames                                    |
| `missions.results(id)`                                      | Accepted answers with short-lived blurred media links and on-chain proof                                          |
| `missions.cancel(id, { txHash? })`                          | Draft: closes at once. Live: returns the `cancelMission` transaction; call again with its hash                    |
| `submissions.accept(id)` / `submissions.reject(id, reason)` | Resolve a submission on-chain (reason ≤ 32 bytes)                                                                 |
| `webhooks.set(url)` / `get()` / `delete()`                  | `submission.processed` webhook; `set` returns the signing secret once                                             |
| `parseUnits("2.5", 6)` / `formatUnits` / `formatAmount`     | Token amount helpers (amounts are base units as strings in the API)                                               |
| `verifyWebhookSignature(...)` / `parseWebhook(...)`         | Check `Seenit-Signature` on a delivery                                                                            |

Answers come from an AI vision model reading the capture after faces and licence plates are blurred. A submission is `needs_review` when the AI is unsure or the capture looks wrong (blurry, dark, screen recapture, not relevant): look at it before accepting. If you don't accept or reject within the review window, the contributor is paid automatically.

## Funding with viem

```ts
import { cancelMission, fundMission } from "seenit-sdk/viem";

const out = await fundMission({
  seenit,
  missionId: mission.id,
  walletClient, // viem WalletClient with the funder account, on Robinhood Chain
  publicClient,
  maxTotal: parseUnits("10", token.decimals), // refuse anything above 10 USDG
});
// out.mission.status === "active"

await cancelMission({ seenit, missionId: mission.id, walletClient, publicClient }); // refunds unused slots
```

Before signing, `fundMission` decodes the transactions the API returned and checks that the approve goes to the reward token for exactly `reward × captures` with the escrow as spender, that `createMission` goes to the escrow with the mission's reward, captures, tier, deadline and spec hash, that the wallet is on the right chain, and that the total is under `maxTotal`. It skips the approve when the allowance already covers the total.

## Webhooks

```ts
const { secret } = await seenit.webhooks.set("https://example.com/seenit"); // store the secret

// In your handler, verify the raw body before parsing it:
const event = await parseWebhook({
  secret,
  signatureHeader: req.headers["seenit-signature"],
  body: rawBody,
});
// event.data: { submissionId, missionId, status, needsReview, reviewReasons, answer, confidence, ... }
```

Deliveries are retried with backoff on non-2xx responses, so de-duplicate on `event.id` (also sent as `Seenit-Delivery`). Signatures older than 5 minutes are rejected by default.

## Examples

- [`examples/create-and-fund.ts`](examples/create-and-fund.ts): create from a template, fund with viem, poll for answers.
- [`examples/review.ts`](examples/review.ts): accept confident answers, leave the rest for a human.
- [`examples/webhook-receiver.ts`](examples/webhook-receiver.ts): verify and handle webhook deliveries.

## Errors

```ts
try {
  await seenit.missions.confirm(id, txHash);
} catch (err) {
  if (err instanceof SeenitError && err.code === "conflict") {
    // e.g. the transaction is not mined yet: retry in a few seconds
  }
}
```

Error codes: `validation_failed`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `precheck_failed`, `rate_limited`, `chain_error`, `upstream_error`, `internal_error`, and `network_error` (status 0) for transport failures.
