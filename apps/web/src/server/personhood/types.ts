import type { PersonhoodProviderId } from "@seenit/shared";

/**
 * What every personhood provider proves, in a provider-neutral shape.
 * Nothing here may contain personal or document data.
 */
export interface VerifiedIdentity {
  /** Wallet the proof is bound to (lowercase 0x address). */
  wallet: string;
  /**
   * Provider-scoped unique identifier for the human. Hashed before it is stored or sent on-chain;
   * the raw value never leaves memory.
   */
  nullifier: string;
  expiresAt: Date;
  /** Non-personal facts about the check (score, threshold, document type...). Stored as-is. */
  summary: Record<string, unknown>;
}

export type StartResult =
  /** Checked synchronously (e.g. Human Passport score). */
  | { kind: "verified"; identity: VerifiedIdentity }
  /** Checked synchronously and not good enough yet. */
  | { kind: "not_eligible"; reason: string; details: Record<string, unknown> }
  /** The user continues in another app; the provider calls our callback later (e.g. Self). */
  | { kind: "redirect"; url: string };

/**
 * Adapter for a proof-of-personhood provider. Adding a provider (e.g. World ID) means writing one
 * of these and registering it in `createPersonhoodProviders`; routes, storage, anti-Sybil checks
 * and on-chain attestation stay the same.
 */
export interface PersonhoodProvider {
  readonly id: PersonhoodProviderId;
  /** Tier granted by this provider. */
  readonly tier: 1 | 2;
  /** PersonhoodRegistry.Provider enum value used on-chain. */
  readonly onchainProvider: number;
  readonly displayName: string;
  readonly flow: "instant" | "redirect";
  start(ctx: { wallet: `0x${string}`; sessionId: string; now: Date }): Promise<StartResult>;
  /** Redirect flows: verify the payload the provider posts to our callback. */
  handleCallback?(payload: unknown, now: Date): Promise<VerifiedIdentity>;
  /** Body the provider expects back from our callback. */
  callbackResponse?(ok: boolean, reason?: string): unknown;
}

/** Provider-side failure that is safe to show (no personal data). */
export class PersonhoodProviderError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    /** True when the provider itself is down / rate limiting (retry later). */
    readonly unavailable = false,
  ) {
    super(message);
  }
}

export type PersonhoodProviders = ReadonlyMap<PersonhoodProviderId, PersonhoodProvider>;
