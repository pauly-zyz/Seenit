import { createHash } from "node:crypto";

import type { Address, Hex } from "viem";

import {
  ChainRevertError,
  type EscrowEvent,
  type EscrowGateway,
  type MissionCreatedEvent,
} from "../chain/types";
import type { MediaStorage } from "../storage/types";

/** In-memory MissionEscrow stand-in. Records calls; tests can queue failures. */
export class FakeEscrowGateway implements EscrowGateway {
  readonly chainId = 31337;
  readonly escrowAddress: Address = "0x00000000000000000000000000000000000e5c20";
  readonly tokenAddress: Address = "0x0000000000000000000000000000000000007070";

  minedMissions = new Map<string, MissionCreatedEvent & { txHash: Hex }>();
  calls: { fn: string; args: unknown[] }[] = [];
  events: EscrowEvent[] = [];
  blockNumber = 0n;
  reviewWindowSeconds = 3n * 24n * 3600n;
  payout = { payout: 1_900_000n, fee: 100_000n };
  contractSignatureValid = false;
  private failures = new Map<string, Error>();
  private nextSubmissionId = 1n;
  private txCounter = 0;

  constructor(private readonly now: () => Date) {}

  reset() {
    this.minedMissions.clear();
    this.calls = [];
    this.events = [];
    this.blockNumber = 0n;
    this.failures.clear();
    this.nextSubmissionId = 1n;
    this.txCounter = 0;
    this.contractSignatureValid = false;
  }

  /** Make the next call to `fn` throw. */
  failNext(fn: "recordSubmission" | "acceptSubmission" | "rejectSubmission", errorName?: string) {
    this.failures.set(fn, new ChainRevertError(`${fn} reverted`, errorName));
  }

  txHash(): Hex {
    this.txCounter++;
    return `0x${this.txCounter.toString(16).padStart(64, "0")}`;
  }

  private maybeFail(fn: string) {
    const err = this.failures.get(fn);
    if (err) {
      this.failures.delete(fn);
      throw err;
    }
  }

  async getMissionCreated(txHash: Hex) {
    this.calls.push({ fn: "getMissionCreated", args: [txHash] });
    return this.minedMissions.get(txHash) ?? null;
  }

  async recordSubmission(missionId: bigint, contributor: Address, mediaHash: Hex) {
    this.calls.push({ fn: "recordSubmission", args: [missionId, contributor, mediaHash] });
    this.maybeFail("recordSubmission");
    const reviewDeadline =
      BigInt(Math.floor(this.now().getTime() / 1000)) + this.reviewWindowSeconds;
    return { txHash: this.txHash(), submissionId: this.nextSubmissionId++, reviewDeadline };
  }

  async acceptSubmission(submissionId: bigint) {
    this.calls.push({ fn: "acceptSubmission", args: [submissionId] });
    this.maybeFail("acceptSubmission");
    return { txHash: this.txHash(), ...this.payout };
  }

  async rejectSubmission(submissionId: bigint, reason: Hex) {
    this.calls.push({ fn: "rejectSubmission", args: [submissionId, reason] });
    this.maybeFail("rejectSubmission");
    return { txHash: this.txHash() };
  }

  async verifyContractSignature() {
    return this.contractSignatureValid;
  }

  async getBlockNumber() {
    return this.blockNumber;
  }

  async getEscrowEvents(fromBlock: bigint, toBlock: bigint) {
    return this.events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }

  callsTo(fn: string) {
    return this.calls.filter((c) => c.fn === fn);
  }
}

/** In-memory object storage. `put` simulates the client's PUT to the signed URL. */
export class FakeStorage implements MediaStorage {
  objects = new Map<string, { bytes: Buffer; contentType: string }>();
  presigned: { key: string; contentType: string; contentLength: number }[] = [];

  reset() {
    this.objects.clear();
    this.presigned = [];
  }

  put(key: string, bytes: Buffer | string, contentType = "image/jpeg") {
    this.objects.set(key, { bytes: Buffer.from(bytes), contentType });
  }

  async presignUpload(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ) {
    this.presigned.push({ key, contentType: opts.contentType, contentLength: opts.contentLength });
    return {
      url: `https://r2.test/${key}?X-Amz-Signature=fake`,
      method: "PUT" as const,
      headers: { "content-type": opts.contentType, "content-length": String(opts.contentLength) },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async presignDownload(key: string, expiresInSeconds: number) {
    return {
      url: `https://r2.test/${key}?X-Amz-Signature=fake-get`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async sha256(key: string) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      sha256: createHash("sha256").update(obj.bytes).digest("hex"),
      size: obj.bytes.length,
      contentType: obj.contentType,
    };
  }
}
