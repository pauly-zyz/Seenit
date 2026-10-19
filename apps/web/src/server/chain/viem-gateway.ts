import { missionEscrowAbi } from "@seenit/shared";
import { parseEventLogs, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";

import { type Clients, createClients, writeAndWait } from "./client";
import { ChainRevertError, type EscrowEvent, type EscrowGateway } from "./types";

const EVENT_NAMES = [
  "MissionCreated",
  "MissionCancelled",
  "MissionRefunded",
  "SubmissionRecorded",
  "SubmissionAccepted",
  "SubmissionRejected",
] as const;

export interface ViemGatewayOptions {
  chainId: number;
  rpcUrl: string;
  escrowAddress: Address;
  tokenAddress: Address;
  operatorPrivateKey: Hex;
}

/** MissionEscrow access over JSON-RPC. The operator key signs record / accept / reject. */
export class ViemEscrowGateway implements EscrowGateway {
  readonly chainId: number;
  readonly escrowAddress: Address;
  readonly tokenAddress: Address;
  private readonly clients: Clients;

  constructor(opts: ViemGatewayOptions) {
    this.chainId = opts.chainId;
    this.escrowAddress = opts.escrowAddress;
    this.tokenAddress = opts.tokenAddress;
    this.clients = createClients({
      chainId: opts.chainId,
      rpcUrl: opts.rpcUrl,
      privateKey: opts.operatorPrivateKey,
    });
  }

  private get publicClient() {
    return this.clients.publicClient;
  }

  async getMissionCreated(txHash: Hex) {
    let receipt: TransactionReceipt;
    try {
      receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
    } catch {
      return null; // unknown or not yet mined
    }
    if (receipt.status !== "success") return null;
    const [log] = parseEventLogs({
      abi: missionEscrowAbi,
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === this.escrowAddress.toLowerCase(),
      ),
      eventName: "MissionCreated",
    });
    if (!log) return null;
    return { ...log.args, txHash };
  }

  async recordSubmission(missionId: bigint, contributor: Address, mediaHash: Hex) {
    const receipt = await this.write("recordSubmission", [missionId, contributor, mediaHash]);
    const [log] = parseEventLogs({
      abi: missionEscrowAbi,
      logs: receipt.logs,
      eventName: "SubmissionRecorded",
    });
    if (!log) throw new ChainRevertError("SubmissionRecorded event missing from receipt");
    return {
      txHash: receipt.transactionHash,
      submissionId: log.args.submissionId,
      reviewDeadline: log.args.reviewDeadline,
    };
  }

  async acceptSubmission(submissionId: bigint) {
    const receipt = await this.write("acceptSubmission", [submissionId]);
    const [log] = parseEventLogs({
      abi: missionEscrowAbi,
      logs: receipt.logs,
      eventName: "SubmissionAccepted",
    });
    if (!log) throw new ChainRevertError("SubmissionAccepted event missing from receipt");
    return { txHash: receipt.transactionHash, payout: log.args.payout, fee: log.args.fee };
  }

  async rejectSubmission(submissionId: bigint, reason: Hex) {
    const receipt = await this.write("rejectSubmission", [submissionId, reason]);
    return { txHash: receipt.transactionHash };
  }

  async verifyContractSignature(address: Address, message: string, signature: Hex) {
    try {
      return await this.publicClient.verifyMessage({ address, message, signature });
    } catch {
      return false;
    }
  }

  getBlockNumber() {
    // viem caches the block number for a few seconds by default; the indexer needs it fresh.
    return this.publicClient.getBlockNumber({ cacheTime: 0 });
  }

  async getEscrowEvents(fromBlock: bigint, toBlock: bigint): Promise<EscrowEvent[]> {
    const logs = await this.publicClient.getLogs({
      address: this.escrowAddress,
      fromBlock,
      toBlock,
    });
    return parseEventLogs({ abi: missionEscrowAbi, logs })
      .filter((l) => (EVENT_NAMES as readonly string[]).includes(l.eventName))
      .map(
        (l) =>
          ({
            name: l.eventName,
            args: l.args,
            txHash: l.transactionHash,
            logIndex: l.logIndex,
            blockNumber: l.blockNumber,
          }) as EscrowEvent,
      );
  }

  private write(
    functionName: "recordSubmission" | "acceptSubmission" | "rejectSubmission",
    args: readonly unknown[],
  ): Promise<TransactionReceipt> {
    return writeAndWait(this.clients, {
      address: this.escrowAddress,
      abi: missionEscrowAbi as Abi,
      functionName,
      args,
    });
  }
}
