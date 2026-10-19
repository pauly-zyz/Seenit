// @vitest-environment node
/**
 * Runs ViemEscrowGateway against the real contracts on a local anvil node.
 * Skipped when anvil or the Foundry build output is not available (e.g. CI's TypeScript job).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { missionEscrowAbi, personhoodRegistryAbi } from "@seenit/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  stringToHex,
  toHex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildFundingTransactions } from "../chain/funding";
import { ChainRevertError } from "../chain/types";
import { ViemEscrowGateway } from "../chain/viem-gateway";

const OUT = join(__dirname, "../../../../../packages/contracts/out");
const ANVIL = [join(homedir(), ".foundry/bin/anvil"), "anvil"].find(
  (bin) => spawnSync(bin, ["--version"]).status === 0,
);
const available = Boolean(ANVIL) && existsSync(join(OUT, "MissionEscrow.sol/MissionEscrow.json"));

// anvil's default dev accounts, derived from its well-known test mnemonic.
const MNEMONIC = "test test test test test test test test test test test junk";
const KEYS: Hex[] = [0, 1, 2, 3, 4, 5, 6].map((i) =>
  toHex(mnemonicToAccount(MNEMONIC, { addressIndex: i }).getHdKey().privateKey!),
);
const PORT = 8545 + Math.floor(Math.random() * 1000) + 100;
const RPC = `http://127.0.0.1:${PORT}`;

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const a = JSON.parse(readFileSync(join(OUT, `${file}/${name}.json`), "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

describe.skipIf(!available)("ViemEscrowGateway on anvil", () => {
  let anvil: ChildProcess;
  let gateway: ViemEscrowGateway;
  let escrow: Address;
  let registry: Address;
  let token: Address;
  const [admin, operator, funder, contributor] = KEYS.map((k) => privateKeyToAccount(k));
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = (i: number) =>
    createWalletClient({ account: privateKeyToAccount(KEYS[i]!), chain, transport: http(RPC) });

  async function deploy(i: number, abi: Abi, bytecode: Hex, args: unknown[]) {
    const hash = await wallet(i).deployContract({ abi, bytecode, args });
    const r = await pub.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  }

  async function send(i: number, to: Address, data: Hex) {
    const hash = await wallet(i).sendTransaction({ to, data });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  beforeAll(async () => {
    anvil = spawn(ANVIL!, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const mock = artifact("MockERC20.sol", "MockERC20");
    const reg = artifact("PersonhoodRegistry.sol", "PersonhoodRegistry");
    const esc = artifact("MissionEscrow.sol", "MissionEscrow");
    token = await deploy(0, mock.abi, mock.bytecode, []);
    registry = await deploy(0, reg.abi, reg.bytecode, [admin!.address, 0, admin!.address]);
    escrow = await deploy(0, esc.abi, esc.bytecode, [
      {
        rewardToken: token,
        registry,
        admin: admin!.address,
        adminDelay: 0,
        operator: operator!.address,
        pauser: admin!.address,
        treasury: admin!.address,
        feeBps: 500,
        tier1MaxReward: 5_000_000n,
        reviewWindow: 3600n,
      },
    ]);

    // contributor gets Tier 1, funder gets tokens
    await wallet(0).writeContract({
      address: registry,
      abi: personhoodRegistryAbi,
      functionName: "attest",
      args: [contributor!.address, 1, `0x${"aa".repeat(32)}`, 4_000_000_000n],
    });
    for (const i of [5, 6]) {
      await wallet(0).writeContract({
        address: registry,
        abi: personhoodRegistryAbi,
        functionName: "attest",
        args: [
          privateKeyToAccount(KEYS[i]!).address,
          1,
          `0x${String(i).repeat(64)}`,
          4_000_000_000n,
        ],
      });
    }
    await wallet(2).writeContract({
      address: token,
      abi: mock.abi,
      functionName: "mint",
      args: [funder!.address, 100_000_000n],
    });

    gateway = new ViemEscrowGateway({
      chainId: foundry.id,
      rpcUrl: RPC,
      escrowAddress: escrow,
      tokenAddress: token,
      operatorPrivateKey: KEYS[1]!,
    });
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  async function fundMission(specHash: Hex, maxCaptures = 2) {
    const block = await pub.getBlock();
    const { transactions } = buildFundingTransactions({
      escrow,
      token,
      rewardPerCapture: 2_000_000n,
      maxCaptures,
      deadline: block.timestamp + 86_400n,
      minTier: 1,
      specHash,
    });
    await send(2, transactions[0]!.to, transactions[0]!.data);
    return send(2, transactions[1]!.to, transactions[1]!.data);
  }

  it("parses MissionCreated from the funder's tx", async () => {
    const specHash: Hex = `0x${"01".repeat(32)}`;
    const txHash = await fundMission(specHash);
    const ev = await gateway.getMissionCreated(txHash);
    expect(ev).toMatchObject({ missionId: 1n, specHash, maxCaptures: 2, minTier: 1, feeBps: 500 });
    expect(ev!.funder.toLowerCase()).toBe(funder!.address.toLowerCase());
    expect(await gateway.getMissionCreated(`0x${"99".repeat(32)}`)).toBeNull();
  });

  it("records, accepts and reports the payout", async () => {
    const rec = await gateway.recordSubmission(1n, contributor!.address, `0x${"0a".repeat(32)}`);
    expect(rec.submissionId).toBe(1n);
    expect(rec.reviewDeadline).toBeGreaterThan(0n);
    const acc = await gateway.acceptSubmission(rec.submissionId);
    expect(acc).toMatchObject({ payout: 1_900_000n, fee: 100_000n });
  });

  it("maps reverts to ChainRevertError with the custom error name", async () => {
    const err = await gateway.acceptSubmission(1n).catch((e) => e);
    expect(err).toBeInstanceOf(ChainRevertError);
    expect(err.errorName).toBe("NotPending");

    const unverified = privateKeyToAccount(KEYS[4]!).address; // never attested
    const err2 = await gateway
      .recordSubmission(1n, unverified, `0x${"0b".repeat(32)}`)
      .catch((e) => e);
    expect(err2.errorName).toBe("NotVerified");
  });

  it("rejects with a bytes32 reason", async () => {
    await fundMission(`0x${"02".repeat(32)}`);
    const rec = await gateway.recordSubmission(2n, contributor!.address, `0x${"0c".repeat(32)}`);
    const res = await gateway.rejectSubmission(
      rec.submissionId,
      stringToHex("blurry", { size: 32 }),
    );
    expect(res.txHash).toMatch(/^0x/);
  });

  it("returns decoded events for the indexer", async () => {
    const latest = await gateway.getBlockNumber();
    const events = await gateway.getEscrowEvents(0n, latest);
    expect(events.map((e) => e.name)).toEqual([
      "MissionCreated",
      "SubmissionRecorded",
      "SubmissionAccepted",
      "MissionCreated",
      "SubmissionRecorded",
      "SubmissionRejected",
    ]);
    const accepted = events.find((e) => e.name === "SubmissionAccepted");
    expect(accepted).toMatchObject({ args: { payout: 1_900_000n, finalized: false } });
  });

  it("sends concurrent operator transactions without nonce clashes", async () => {
    await fundMission(`0x${"03".repeat(32)}`, 3);
    const contributors = [
      contributor!.address,
      ...[5, 6].map((i) => privateKeyToAccount(KEYS[i]!).address),
    ];
    const results = await Promise.all(
      contributors.map((c, i) =>
        gateway.recordSubmission(3n, c, `0x${String(i + 1).repeat(64)}` as Hex),
      ),
    );
    expect(new Set(results.map((r) => r.submissionId)).size).toBe(3);
    expect(new Set(results.map((r) => r.txHash)).size).toBe(3);
  });
});

// Keep the ABI import used even when the suite is skipped.
void missionEscrowAbi;
