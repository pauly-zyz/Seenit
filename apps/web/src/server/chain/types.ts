import type { Address, Hex } from "viem";

export interface TxRequest {
  to: Address;
  data: Hex;
  value: "0";
  description: string;
}

export interface MissionCreatedEvent {
  missionId: bigint;
  funder: Address;
  rewardPerCapture: bigint;
  maxCaptures: number;
  deadline: bigint;
  minTier: number;
  feeBps: number;
  specHash: Hex;
}

type Meta = { txHash: Hex; logIndex: number; blockNumber: bigint };

/** Decoded MissionEscrow events the indexer cares about. */
export type EscrowEvent = Meta &
  (
    | { name: "MissionCreated"; args: MissionCreatedEvent }
    | { name: "MissionCancelled"; args: { missionId: bigint; refunded: bigint } }
    | { name: "MissionRefunded"; args: { missionId: bigint; refunded: bigint } }
    | {
        name: "SubmissionRecorded";
        args: {
          submissionId: bigint;
          missionId: bigint;
          contributor: Address;
          mediaHash: Hex;
          reviewDeadline: bigint;
        };
      }
    | {
        name: "SubmissionAccepted";
        args: {
          submissionId: bigint;
          missionId: bigint;
          contributor: Address;
          payout: bigint;
          fee: bigint;
          finalized: boolean;
        };
      }
    | {
        name: "SubmissionRejected";
        args: { submissionId: bigint; missionId: bigint; reason: Hex; refunded: bigint };
      }
  );

/** Thrown when a contract call reverts; `errorName` is the Solidity custom error, if decoded. */
export class ChainRevertError extends Error {
  constructor(
    message: string,
    readonly errorName?: string,
  ) {
    super(message);
  }
}

/** Everything the API needs from MissionEscrow. Implemented with viem; faked in tests. */
export interface EscrowGateway {
  readonly chainId: number;
  readonly escrowAddress: Address;
  readonly tokenAddress: Address;
  /** Parses MissionCreated from a confirmed tx. Null if the tx is unknown, pending or has no such event. */
  getMissionCreated(txHash: Hex): Promise<(MissionCreatedEvent & { txHash: Hex }) | null>;
  recordSubmission(
    missionId: bigint,
    contributor: Address,
    mediaHash: Hex,
  ): Promise<{ txHash: Hex; submissionId: bigint; reviewDeadline: bigint }>;
  acceptSubmission(submissionId: bigint): Promise<{ txHash: Hex; payout: bigint; fee: bigint }>;
  rejectSubmission(submissionId: bigint, reason: Hex): Promise<{ txHash: Hex }>;
  /** ERC-1271 / ERC-6492 signature check for smart-contract wallets. */
  verifyContractSignature(address: Address, message: string, signature: Hex): Promise<boolean>;
  getBlockNumber(): Promise<bigint>;
  getEscrowEvents(fromBlock: bigint, toBlock: bigint): Promise<EscrowEvent[]>;
}
