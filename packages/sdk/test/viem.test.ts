import { missionEscrowAbi } from "@seenit/shared";
import { encodeFunctionData, erc20Abi, toFunctionSignature, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { Seenit } from "../src/index.js";
import {
  cancelMission,
  checkFundingTransactions,
  fundMission,
  missionEscrowFunderAbi,
  UnsafeTransactionError,
  type FunderWallet,
} from "../src/viem.js";

const ESCROW = "0x00000000000000000000000000000000000e5c20" as Hex;
const TOKEN = "0x0000000000000000000000000000000000007070" as Hex;
const FUNDER = "0x00000000000000000000000000000000000000f1" as Hex;
const SPEC = `0x${"ab".repeat(32)}` as Hex;
const DEADLINE = "2026-11-03T10:00:00.000Z";

const mission = {
  id: "m1",
  reward: "2000000",
  maxCaptures: 3,
  minTier: 1,
  specHash: SPEC,
  deadline: DEADLINE,
  status: "pending_funding",
  onchainId: null as string | null,
};

function fundingTxs(over: { spender?: Hex; amount?: bigint; reward?: bigint; to?: Hex } = {}) {
  return [
    {
      to: TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [over.spender ?? ESCROW, over.amount ?? 6_000_000n],
      }),
      value: "0" as const,
      description: "Approve",
    },
    {
      to: over.to ?? ESCROW,
      data: encodeFunctionData({
        abi: missionEscrowAbi,
        functionName: "createMission",
        args: [over.reward ?? 2_000_000n, 3, BigInt(Date.parse(DEADLINE) / 1000), 1, SPEC],
      }),
      value: "0" as const,
      description: "Create",
    },
  ];
}

describe("missionEscrowFunderAbi", () => {
  it("matches the contract ABI exported to packages/shared", () => {
    for (const name of ["createMission", "cancelMission"] as const) {
      const ours = missionEscrowFunderAbi.find((f) => f.name === name)!;
      const theirs = missionEscrowAbi.find((f) => f.type === "function" && f.name === name)!;
      expect(toFunctionSignature(ours)).toBe(toFunctionSignature(theirs as never));
    }
  });
});

describe("checkFundingTransactions", () => {
  const base = { mission, escrow: ESCROW, token: TOKEN, total: 6_000_000n };

  it("accepts the transactions the API builds", () => {
    expect(() => checkFundingTransactions({ ...base, transactions: fundingTxs() })).not.toThrow();
  });

  it.each([
    ["approve to another spender", fundingTxs({ spender: FUNDER }), /spender/],
    ["approve for more than the total", fundingTxs({ amount: 10n ** 30n }), /amount/],
    ["createMission elsewhere", fundingTxs({ to: FUNDER }), /escrow/],
    ["different reward", fundingTxs({ reward: 1n }), /arguments/],
  ])("rejects %s", (_n, transactions, msg) => {
    expect(() => checkFundingTransactions({ ...base, transactions })).toThrow(msg);
  });

  it("rejects a total that doesn't match", () => {
    expect(() =>
      checkFundingTransactions({ ...base, total: 1n, transactions: fundingTxs() }),
    ).toThrow(UnsafeTransactionError);
  });
});

/** Fake API + chain for the end-to-end helpers. */
function setup(opts: { allowance?: bigint; chainId?: number; status?: string } = {}) {
  const sent: { to: Hex; data: Hex }[] = [];
  const api: string[] = [];
  let state = opts.status ?? "pending_funding";
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    api.push(`${init.method} ${path} ${init.body ?? ""}`.trim());
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "/api/meta")
      return json({
        chainId: 46630,
        escrow: ESCROW,
        token: { address: TOKEN, symbol: "USDG", decimals: 6 },
      });
    if (path.endsWith("/status")) {
      return json({
        mission: { ...mission, status: state, onchainId: state === "active" ? "7" : null },
        funding:
          state === "pending_funding" ? { total: "6000000", transactions: fundingTxs() } : null,
      });
    }
    if (path.endsWith("/confirm")) {
      state = "active";
      return json({ ...mission, status: "active", onchainId: "7" });
    }
    if (path.endsWith("/cancel")) {
      const body = JSON.parse(init.body as string);
      if (body.txHash)
        return json({
          mission: { ...mission, status: "cancelled" },
          cancelled: true,
          refunded: "6000000",
          transactions: [],
        });
      return json({
        mission: { ...mission, status: "active", onchainId: "7" },
        cancelled: false,
        transactions: [
          {
            to: ESCROW,
            data: encodeFunctionData({
              abi: missionEscrowFunderAbi,
              functionName: "cancelMission",
              args: [7n],
            }),
            value: "0",
            description: "Cancel",
          },
        ],
      });
    }
    return json({ error: { code: "not_found", message: path } }, 404);
  }) as unknown as typeof fetch;

  const walletClient = {
    account: { address: FUNDER },
    chain: undefined,
    getChainId: async () => opts.chainId ?? 46630,
    sendTransaction: async (tx: { to: Hex; data: Hex }) => {
      sent.push(tx);
      return `0x${String(sent.length).padStart(64, "0")}` as Hex;
    },
  } as unknown as FunderWallet;
  const publicClient = {
    readContract: async () => opts.allowance ?? 0n,
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as never;
  const seenit = new Seenit({ apiKey: "k", baseUrl: "https://api.test", fetch: fetchFn });
  return { seenit, walletClient, publicClient, sent, api };
}

describe("fundMission", () => {
  it("approves, creates the mission and confirms it with the API", async () => {
    const s = setup();
    const seen: string[] = [];
    const out = await fundMission({
      ...s,
      missionId: "m1",
      maxTotal: 10_000_000n,
      onTransaction: (t) => seen.push(t.kind),
    });
    expect(s.sent.map((t) => t.to)).toEqual([TOKEN, ESCROW]);
    expect(seen).toEqual(["approve", "create"]);
    expect(out.mission.status).toBe("active");
    expect(s.api.at(-1)).toBe(`POST /api/missions/m1/confirm {"txHash":"${out.createTxHash}"}`);
  });

  it("skips approve when the allowance already covers the total", async () => {
    const s = setup({ allowance: 6_000_000n });
    const out = await fundMission({ ...s, missionId: "m1" });
    expect(out.approveTxHash).toBeNull();
    expect(s.sent).toHaveLength(1);
  });

  it("refuses above the spending cap or on the wrong chain, before sending anything", async () => {
    const capped = setup();
    await expect(fundMission({ ...capped, missionId: "m1", maxTotal: 5_000_000n })).rejects.toThrow(
      /spending cap/,
    );
    const wrong = setup({ chainId: 1 });
    await expect(fundMission({ ...wrong, missionId: "m1" })).rejects.toThrow(/chain 1/);
    expect([...capped.sent, ...wrong.sent]).toHaveLength(0);
  });

  it("does nothing for a mission that is already live", async () => {
    const s = setup({ status: "active" });
    expect((await fundMission({ ...s, missionId: "m1" })).createTxHash).toBeNull();
    expect(s.sent).toHaveLength(0);
  });
});

describe("cancelMission", () => {
  it("signs cancelMission and reports the refund", async () => {
    const s = setup({ status: "active" });
    const out = await cancelMission({ ...s, missionId: "m1" });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe(ESCROW);
    expect(out).toMatchObject({ refunded: "6000000", mission: { status: "cancelled" } });
  });
});
