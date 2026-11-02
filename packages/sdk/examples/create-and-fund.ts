/**
 * Create a mission from a template, fund it from your own wallet, and wait for answers.
 *
 *   SEENIT_API_URL=... SEENIT_API_KEY=sk_... FUNDER_PRIVATE_KEY=0x... RPC_URL=... \
 *     npx tsx examples/create-and-fund.ts
 */
import { formatAmount, parseUnits, Seenit } from "seenit-sdk";
import { fundMission } from "seenit-sdk/viem";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const seenit = new Seenit(); // reads SEENIT_API_URL and SEENIT_API_KEY
const meta = await seenit.meta();

// 1. Save the mission (a draft: nothing is live, no money moves).
const { mission, funding } = await seenit.missions.create({
  title: "Is Luna Bakery open right now?",
  instructions:
    "Photograph the entrance from the street so the door and any posted notice are visible.",
  mediaType: "photo",
  location: { lat: -6.175392, lng: 106.827153 },
  radiusMeters: 100,
  rewardPerSubmission: parseUnits("2", meta.token.decimals),
  maxSubmissions: 3,
  deadline: new Date(Date.now() + 6 * 3600_000),
  template: "store_open",
});
console.log(
  `Draft ${mission.id}: ${formatAmount(funding.total, meta.token.decimals, meta.token.symbol)} to escrow`,
);

// 2. Fund it. The helper checks every transaction (token, escrow, amounts, spec hash) before signing.
const chain = defineChain({
  id: meta.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL!] } },
});
const account = privateKeyToAccount(process.env.FUNDER_PRIVATE_KEY as Hex);
const walletClient = createWalletClient({ account, chain, transport: http() });
const publicClient = createPublicClient({ chain, transport: http() });
const live = await fundMission({
  seenit,
  missionId: mission.id,
  walletClient,
  publicClient,
  maxTotal: parseUnits("10", meta.token.decimals), // refuse anything above 10 USDG
  onTransaction: (tx) => console.log(`${tx.kind}: ${tx.hash}`),
});
console.log(`Live: ${live.mission.status}`);

// 3. Poll for answers (or use a webhook, see webhook-receiver.ts).
for (;;) {
  const s = await seenit.missions.status(mission.id);
  console.log(
    `${s.submissions.ready} ready, ${s.submissions.needsReview} need review, ${s.submissions.accepted} accepted`,
  );
  if (s.submissions.ready + s.submissions.needsReview + s.submissions.accepted > 0) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
const queue = await seenit.missions.submissions(mission.id);
for (const item of queue.submissions) {
  console.log(item.submissionId, item.status, item.ai?.answer, item.media?.frames[0]?.url);
}
