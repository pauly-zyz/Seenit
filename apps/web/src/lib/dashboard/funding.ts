import { checkFundingTransactions } from "seenit-sdk/viem";
import { erc20Abi, type Hex } from "viem";

import { DashboardApiError, type DashboardApi } from "./api";
import type { Funding, Meta, Mission } from "./types";

/** Wallet actions the funding flow needs (wired to wagmi in the app, faked in tests). */
export interface WalletActions {
  account: Hex;
  getChainId(): Promise<number>;
  switchChain(chainId: number): Promise<void>;
  readAllowance(token: Hex, owner: Hex, spender: Hex): Promise<bigint>;
  sendTransaction(tx: { to: Hex; data: Hex }): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted" }>;
}

export type FundingStep =
  | { step: "checking" }
  | { step: "switching-chain"; chainId: number }
  | { step: "approve"; status: "signing" | "pending" | "skipped" | "done"; hash?: Hex }
  | { step: "create"; status: "signing" | "pending" | "done"; hash?: Hex }
  | { step: "confirming" }
  | { step: "live"; mission: Mission };

export { erc20Abi };

/**
 * Funds a draft from the connected wallet: verifies the API-built transactions, switches to the
 * right chain, approves (skipped if the allowance covers it), sends createMission, then confirms.
 */
export async function fundMission(args: {
  api: Pick<DashboardApi, "confirmMission">;
  wallet: WalletActions;
  mission: Mission;
  funding: Funding;
  meta: Meta;
  onStep?: (s: FundingStep) => void;
}): Promise<Mission> {
  const { api, wallet, mission, funding, meta } = args;
  const step = args.onStep ?? (() => undefined);
  const total = BigInt(funding.total);

  step({ step: "checking" });
  checkFundingTransactions({
    mission,
    transactions: funding.transactions,
    escrow: meta.escrow,
    token: meta.token.address,
    total,
  });

  if ((await wallet.getChainId()) !== meta.chainId) {
    step({ step: "switching-chain", chainId: meta.chainId });
    await wallet.switchChain(meta.chainId);
  }

  const [approve, create] = funding.transactions as [
    Funding["transactions"][0],
    Funding["transactions"][0],
  ];
  const allowance = await wallet.readAllowance(meta.token.address, wallet.account, meta.escrow);
  if (allowance >= total) {
    step({ step: "approve", status: "skipped" });
  } else {
    step({ step: "approve", status: "signing" });
    const hash = await wallet.sendTransaction({ to: approve.to, data: approve.data });
    step({ step: "approve", status: "pending", hash });
    if ((await wallet.waitForReceipt(hash)).status !== "success")
      throw new Error("The approve transaction failed");
    step({ step: "approve", status: "done", hash });
  }

  step({ step: "create", status: "signing" });
  const hash = await wallet.sendTransaction({ to: create.to, data: create.data });
  step({ step: "create", status: "pending", hash });
  if ((await wallet.waitForReceipt(hash)).status !== "success")
    throw new Error("The createMission transaction failed");
  step({ step: "create", status: "done", hash });

  step({ step: "confirming" });
  const live = await retryConflict(() => api.confirmMission(mission.id, hash));
  step({ step: "live", mission: live });
  return live;
}

/** The API's node may lag the wallet's by a block: retry "not mined yet" a few times. */
async function retryConflict<T>(fn: () => Promise<T>, attempts = 6, delayMs = 1500): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof DashboardApiError) || err.status !== 409 || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
