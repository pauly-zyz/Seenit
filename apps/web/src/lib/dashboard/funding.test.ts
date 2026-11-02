// @vitest-environment node
import { missionEscrowAbi } from "@seenit/shared";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { DashboardApiError } from "./api";
import { fundMission, type FundingStep, type WalletActions } from "./funding";
import type { Funding, Meta, Mission } from "./types";

const ESCROW = "0x00000000000000000000000000000000000e5c20" as Hex;
const TOKEN = "0x0000000000000000000000000000000000007070" as Hex;
const ME = "0x00000000000000000000000000000000000000f1" as Hex;
const SPEC = `0x${"ab".repeat(32)}` as Hex;
const DEADLINE = "2026-11-03T10:00:00.000Z";

const meta: Meta = {
  chainId: 46630,
  escrow: ESCROW,
  token: { address: TOKEN, symbol: "USDG", decimals: 6 },
  tier1MaxReward: "5000000",
};
const mission = {
  id: "m1",
  reward: "2000000",
  maxCaptures: 3,
  minTier: 1,
  specHash: SPEC,
  deadline: DEADLINE,
  status: "pending_funding",
} as Mission;

function funding(spender: Hex = ESCROW): Funding {
  return {
    chainId: 46630,
    escrow: ESCROW,
    token: TOKEN,
    total: "6000000",
    transactions: [
      {
        to: TOKEN,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, 6_000_000n],
        }),
        value: "0",
        description: "Approve",
      },
      {
        to: ESCROW,
        data: encodeFunctionData({
          abi: missionEscrowAbi,
          functionName: "createMission",
          args: [2_000_000n, 3, BigInt(Date.parse(DEADLINE) / 1000), 1, SPEC],
        }),
        value: "0",
        description: "Create",
      },
    ],
  };
}

function wallet(over: Partial<WalletActions> = {}) {
  const sent: { to: Hex; data: Hex }[] = [];
  const w: WalletActions = {
    account: ME,
    getChainId: async () => 46630,
    switchChain: vi.fn(async () => undefined),
    readAllowance: async () => 0n,
    sendTransaction: async (tx) => {
      sent.push(tx);
      return `0x${String(sent.length).padStart(64, "0")}` as Hex;
    },
    waitForReceipt: async () => ({ status: "success" }),
    ...over,
  };
  return { w, sent };
}

const live = { ...mission, status: "active" } as Mission;

describe("fundMission", () => {
  it("approves, creates and confirms, reporting each step", async () => {
    const { w, sent } = wallet();
    const confirmMission = vi.fn(async () => live);
    const steps: FundingStep[] = [];
    const out = await fundMission({
      api: { confirmMission },
      wallet: w,
      mission,
      funding: funding(),
      meta,
      onStep: (s) => steps.push(s),
    });
    expect(out.status).toBe("active");
    expect(sent.map((t) => t.to)).toEqual([TOKEN, ESCROW]);
    expect(confirmMission).toHaveBeenCalledWith("m1", `0x${"2".padStart(64, "0")}`);
    expect(steps.map((s) => ("status" in s ? `${s.step}:${s.status}` : s.step))).toEqual([
      "checking",
      "approve:signing",
      "approve:pending",
      "approve:done",
      "create:signing",
      "create:pending",
      "create:done",
      "confirming",
      "live",
    ]);
  });

  it("switches chain first and skips approve when the allowance covers the total", async () => {
    const { w, sent } = wallet({
      getChainId: async () => 1,
      readAllowance: async () => 10_000_000n,
    });
    await fundMission({
      api: { confirmMission: async () => live },
      wallet: w,
      mission,
      funding: funding(),
      meta,
    });
    expect(w.switchChain).toHaveBeenCalledWith(46630);
    expect(sent).toHaveLength(1);
  });

  it("refuses transactions that don't match the mission before asking the wallet", async () => {
    const { w, sent } = wallet();
    await expect(
      fundMission({
        api: { confirmMission: async () => live },
        wallet: w,
        mission,
        funding: funding(ME),
        meta,
      }),
    ).rejects.toThrow(/spender/);
    expect(sent).toHaveLength(0);
  });

  it("stops when a transaction reverts", async () => {
    const { w } = wallet({ waitForReceipt: async () => ({ status: "reverted" }) });
    const confirmMission = vi.fn();
    await expect(
      fundMission({ api: { confirmMission }, wallet: w, mission, funding: funding(), meta }),
    ).rejects.toThrow(/approve/);
    expect(confirmMission).not.toHaveBeenCalled();
  });

  it("retries confirm while the API hasn't seen the block yet", async () => {
    vi.useFakeTimers();
    const { w } = wallet({ readAllowance: async () => 10n ** 18n });
    let calls = 0;
    const confirmMission = async () => {
      if (++calls < 3) throw new DashboardApiError(409, "conflict", "not mined yet");
      return live;
    };
    const p = fundMission({
      api: { confirmMission },
      wallet: w,
      mission,
      funding: funding(),
      meta,
    });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe("active");
    expect(calls).toBe(3);
    vi.useRealTimers();
  });
});
