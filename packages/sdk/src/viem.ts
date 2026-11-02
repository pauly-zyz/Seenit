/**
 * Optional on-chain helpers (requires `viem`). The API never holds funder keys: these sign the
 * funding / cancel transactions with your own wallet client, then tell the API.
 *
 * Every transaction the API returns is decoded and checked before signing: right contract,
 * right function, amounts and spec hash matching the mission, and an optional spending cap.
 */
import {
  decodeFunctionData,
  erc20Abi,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { SeenitError, type Seenit } from "./client.js";
import type { Hex, Mission, TxRequest } from "./types.js";

/** The two MissionEscrow functions a funder calls (subset of the contract ABI). */
export const missionEscrowFunderAbi = [
  {
    type: "function",
    name: "createMission",
    inputs: [
      { name: "rewardPerCapture", type: "uint128" },
      { name: "maxCaptures", type: "uint32" },
      { name: "deadline", type: "uint64" },
      { name: "minTier", type: "uint8" },
      { name: "specHash", type: "bytes32" },
    ],
    outputs: [{ name: "missionId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelMission",
    inputs: [{ name: "missionId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export type FunderWallet = WalletClient<Transport, Chain | undefined, Account>;

export interface OnChainOptions {
  seenit: Seenit;
  missionId: string;
  /** Wallet client with an account: the funder's wallet. */
  walletClient: FunderWallet;
  publicClient: PublicClient;
  /** Called after each transaction is sent. */
  onTransaction?: (tx: {
    hash: Hex;
    kind: "approve" | "create" | "cancel";
    description: string;
  }) => void;
}

/** A transaction from the API that doesn't match what the mission should do. */
export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTransactionError";
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Checks the approve + createMission pair against the mission and the API's published contracts. */
export function checkFundingTransactions(args: {
  mission: Pick<Mission, "reward" | "maxCaptures" | "minTier" | "specHash" | "deadline">;
  transactions: TxRequest[];
  escrow: Hex;
  token: Hex;
  total: bigint;
}) {
  const [approve, create] = args.transactions;
  if (args.transactions.length !== 2 || !approve || !create) {
    throw new UnsafeTransactionError("Expected exactly two funding transactions");
  }
  const expectedTotal = BigInt(args.mission.reward) * BigInt(args.mission.maxCaptures);
  if (args.total !== expectedTotal)
    throw new UnsafeTransactionError("Funding total doesn't match reward × captures");

  if (!same(approve.to, args.token))
    throw new UnsafeTransactionError("Approve is not sent to the reward token");
  const a = decodeFunctionData({ abi: erc20Abi, data: approve.data });
  if (a.functionName !== "approve")
    throw new UnsafeTransactionError("First transaction is not approve");
  const [spender, amount] = a.args as readonly [Hex, bigint];
  if (!same(spender, args.escrow))
    throw new UnsafeTransactionError("Approve spender is not the escrow");
  if (amount !== expectedTotal)
    throw new UnsafeTransactionError("Approve amount doesn't match the mission total");

  if (!same(create.to, args.escrow))
    throw new UnsafeTransactionError("createMission is not sent to the escrow");
  const c = decodeFunctionData({ abi: missionEscrowFunderAbi, data: create.data });
  if (c.functionName !== "createMission")
    throw new UnsafeTransactionError("Second transaction is not createMission");
  const [reward, captures, deadline, minTier, specHash] = c.args as readonly [
    bigint,
    number,
    bigint,
    number,
    Hex,
  ];
  if (
    reward !== BigInt(args.mission.reward) ||
    captures !== args.mission.maxCaptures ||
    minTier !== args.mission.minTier ||
    !same(specHash, args.mission.specHash) ||
    deadline !== BigInt(Math.floor(new Date(args.mission.deadline).getTime() / 1000))
  ) {
    throw new UnsafeTransactionError("createMission arguments don't match the mission");
  }
}

async function assertChain(o: OnChainOptions, chainId: number) {
  const walletChain = await o.walletClient.getChainId();
  if (walletChain !== chainId) {
    throw new UnsafeTransactionError(
      `Wallet is on chain ${walletChain}, Seenit expects ${chainId}`,
    );
  }
}

async function send(
  o: OnChainOptions,
  tx: TxRequest,
  kind: "approve" | "create" | "cancel",
): Promise<Hex> {
  const hash = await o.walletClient.sendTransaction({
    account: o.walletClient.account,
    chain: o.walletClient.chain,
    to: tx.to,
    data: tx.data,
    value: 0n,
  });
  o.onTransaction?.({ hash, kind, description: tx.description });
  const receipt = await o.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new SeenitError(0, "tx_reverted", `${tx.description} reverted (${hash})`);
  return hash;
}

/** Retries an API call that may race the chain node (e.g. "not mined yet" right after a receipt). */
async function untilIndexed<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof SeenitError) || err.status !== 409 || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

/**
 * Funds a `pending_funding` mission: approve (skipped if the allowance already covers it),
 * createMission, then confirms with the API. Returns the live mission.
 */
export async function fundMission(
  o: OnChainOptions & {
    /** Refuse to fund above this total (token base units). */
    maxTotal?: bigint;
  },
): Promise<{ mission: Mission; createTxHash: Hex | null; approveTxHash: Hex | null }> {
  const status = await o.seenit.missions.status(o.missionId);
  if (status.mission.status === "active")
    return { mission: status.mission, createTxHash: null, approveTxHash: null };
  if (status.mission.status !== "pending_funding" || !status.funding) {
    throw new SeenitError(
      409,
      "conflict",
      `Mission is ${status.mission.status} and can't be funded`,
    );
  }
  const meta = await o.seenit.meta();
  const total = BigInt(status.funding.total);
  checkFundingTransactions({
    mission: status.mission,
    transactions: status.funding.transactions,
    escrow: meta.escrow,
    token: meta.token.address,
    total,
  });
  if (o.maxTotal !== undefined && total > o.maxTotal) {
    throw new UnsafeTransactionError(
      `Mission total ${total} is above the spending cap ${o.maxTotal}`,
    );
  }
  await assertChain(o, meta.chainId);

  const [approve, create] = status.funding.transactions as [TxRequest, TxRequest];
  const allowance = await o.publicClient.readContract({
    address: meta.token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [o.walletClient.account.address, meta.escrow],
  });
  const approveTxHash = allowance >= total ? null : await send(o, approve, "approve");
  const createTxHash = await send(o, create, "create");
  const mission = await untilIndexed(() => o.seenit.missions.confirm(o.missionId, createTxHash));
  return { mission, createTxHash, approveTxHash };
}

/** Cancels a mission: closes a draft, or signs cancelMission for a funded one (unused slots refunded). */
export async function cancelMission(
  o: OnChainOptions,
): Promise<{ mission: Mission; txHash: Hex | null; refunded?: string }> {
  const first = await o.seenit.missions.cancel(o.missionId);
  if (first.cancelled) return { mission: first.mission, txHash: null, refunded: first.refunded };
  const meta = await o.seenit.meta();
  const [tx] = first.transactions;
  if (first.transactions.length !== 1 || !tx || !same(tx.to, meta.escrow)) {
    throw new UnsafeTransactionError("Unexpected cancel transaction");
  }
  const d = decodeFunctionData({ abi: missionEscrowFunderAbi, data: tx.data });
  if (d.functionName !== "cancelMission" || String(d.args[0]) !== String(first.mission.onchainId)) {
    throw new UnsafeTransactionError("cancelMission is for a different mission");
  }
  await assertChain(o, meta.chainId);
  const txHash = await send(o, tx, "cancel");
  const done = await untilIndexed(() => o.seenit.missions.cancel(o.missionId, { txHash }));
  return { mission: done.mission, txHash, refunded: done.refunded };
}
