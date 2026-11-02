#!/usr/bin/env node
/**
 * Copies deployed contract addresses into each app's local env file (never secrets).
 *
 *   node scripts/sync-env.mjs              # chain 46630 (Robinhood Chain testnet)
 *   node scripts/sync-env.mjs --chain 46630 --deployment path/to/deployment.json --root .
 *
 * Reads packages/contracts/deployments/<chainId>.json (written by Deploy.s.sol) and sets:
 *   apps/web/.env.local   CHAIN_ID, MISSION_ESCROW_ADDRESS, PERSONHOOD_REGISTRY_ADDRESS,
 *                         REWARD_TOKEN_ADDRESS, INDEXER_START_BLOCK, NEXT_PUBLIC_CHAIN_ID
 *   apps/mobile/.env      EXPO_PUBLIC_CHAIN_ID
 * Other keys in those files are kept as they are. Missing files are created from .env.example.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc),
      [],
    ),
);
const root = resolve(args.root ?? ".");
const chainId = Number(args.chain ?? 46630);
const deploymentPath =
  args.deployment ?? join(root, "packages/contracts/deployments", `${chainId}.json`);
if (!existsSync(deploymentPath)) {
  console.error(
    `No deployment file at ${deploymentPath}. Deploy first (pnpm -F @seenit/contracts deploy:testnet).`,
  );
  process.exit(1);
}
const d = JSON.parse(readFileSync(deploymentPath, "utf8"));
const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
for (const k of ["missionEscrow", "personhoodRegistry", "rewardToken"]) {
  if (!isAddress(d[k])) throw new Error(`deployment.${k} is not an address`);
}
if (d.chainId !== chainId) throw new Error(`deployment is for chain ${d.chainId}, not ${chainId}`);

/** Sets KEY=value lines, keeping comments, order and every other key. */
function upsert(file, example, values) {
  let text = existsSync(file)
    ? readFileSync(file, "utf8")
    : existsSync(example)
      ? readFileSync(example, "utf8")
      : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(file, text);
  console.log(`updated ${file.replace(`${root}/`, "")}: ${Object.keys(values).join(", ")}`);
}

upsert(join(root, "apps/web/.env.local"), join(root, "apps/web/.env.example"), {
  CHAIN_ID: chainId,
  NEXT_PUBLIC_CHAIN_ID: chainId,
  MISSION_ESCROW_ADDRESS: d.missionEscrow,
  PERSONHOOD_REGISTRY_ADDRESS: d.personhoodRegistry,
  REWARD_TOKEN_ADDRESS: d.rewardToken,
  INDEXER_START_BLOCK: d.blockNumber,
});
upsert(join(root, "apps/mobile/.env"), join(root, "apps/mobile/.env.example"), {
  EXPO_PUBLIC_CHAIN_ID: chainId,
});
console.log(
  "The MCP server and the SDK read contract addresses from GET /api/meta: nothing to set there.",
);
