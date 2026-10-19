import { missionEscrowAbi } from "@seenit/shared";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import type { TxRequest } from "./types";

/**
 * The two transactions a funder signs to fund a mission:
 * approve the escrow for the total, then createMission.
 */
export function buildFundingTransactions(args: {
  escrow: Address;
  token: Address;
  rewardPerCapture: bigint;
  maxCaptures: number;
  deadline: bigint;
  minTier: number;
  specHash: Hex;
}): { total: bigint; transactions: TxRequest[] } {
  const total = args.rewardPerCapture * BigInt(args.maxCaptures);
  return {
    total,
    transactions: [
      {
        to: args.token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [args.escrow, total],
        }),
        value: "0",
        description: "Approve the escrow to pull the mission total",
      },
      {
        to: args.escrow,
        data: encodeFunctionData({
          abi: missionEscrowAbi,
          functionName: "createMission",
          args: [
            args.rewardPerCapture,
            args.maxCaptures,
            args.deadline,
            args.minTier,
            args.specHash,
          ],
        }),
        value: "0",
        description: "Create and fund the mission",
      },
    ],
  };
}
