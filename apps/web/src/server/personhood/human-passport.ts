import { z } from "zod";

import { PersonhoodProviderError, type PersonhoodProvider, type StartResult } from "./types";

/**
 * Human Passport (passport.human.tech), Stamps API v2:
 *   GET {apiUrl}/v2/stamps/{scorer_id}/score/{address}   header: X-API-Key
 * The endpoint scores the address on request and returns `score` / `threshold` as decimal strings.
 *
 * Passport has no nullifier. Uniqueness comes from Passport's stamp de-duplication: a stamp already
 * used by another wallet in the same scorer does not count. Our on-chain identifier is therefore
 * derived from scorer + wallet.
 */
export interface HumanPassportConfig {
  apiUrl: string;
  apiKey: string;
  scorerId: string;
  /** Minimum Unique Humanity Score for Tier 1. */
  minScore: number;
  /** Upper bound on how long the attestation is valid. */
  ttlDays: number;
}

const scoreResponse = z.object({
  address: z.string(),
  score: z.string().nullable(),
  passing_score: z.boolean(),
  threshold: z.string(),
  expiration_timestamp: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export class HumanPassportProvider implements PersonhoodProvider {
  readonly id = "human_passport" as const;
  readonly tier = 1 as const;
  readonly onchainProvider = 1; // PersonhoodRegistry.Provider.HumanPassport
  readonly displayName = "Human Passport";
  readonly flow = "instant" as const;

  constructor(
    private readonly cfg: HumanPassportConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async start({ wallet, now }: { wallet: `0x${string}`; now: Date }): Promise<StartResult> {
    const url = `${this.cfg.apiUrl.replace(/\/$/, "")}/v2/stamps/${encodeURIComponent(this.cfg.scorerId)}/score/${wallet}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { "X-API-Key": this.cfg.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new PersonhoodProviderError(
        "provider_unreachable",
        "Human Passport did not respond",
        true,
      );
    }
    if (res.status === 429 || res.status >= 500) {
      throw new PersonhoodProviderError(
        "provider_unavailable",
        `Human Passport returned ${res.status}`,
        true,
      );
    }
    if (!res.ok) {
      throw new PersonhoodProviderError(
        "provider_rejected",
        `Human Passport returned ${res.status}`,
      );
    }

    const parsed = scoreResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new PersonhoodProviderError(
        "provider_bad_response",
        "Unexpected Human Passport response",
      );
    }
    const body = parsed.data;
    if (body.address.toLowerCase() !== wallet.toLowerCase()) {
      throw new PersonhoodProviderError(
        "provider_bad_response",
        "Score returned for a different address",
      );
    }

    const score = Number(body.score ?? "0");
    const details = {
      score,
      requiredScore: this.cfg.minScore,
      getStampsUrl: "https://app.passport.xyz",
    };
    if (body.error)
      return {
        kind: "not_eligible",
        reason: "score_error",
        details: { ...details, error: body.error },
      };
    if (!Number.isFinite(score) || score < this.cfg.minScore) {
      return { kind: "not_eligible", reason: "score_too_low", details };
    }

    const cap = new Date(now.getTime() + this.cfg.ttlDays * 86_400_000);
    const providerExpiry = body.expiration_timestamp ? new Date(body.expiration_timestamp) : null;
    const expiresAt =
      providerExpiry && !Number.isNaN(providerExpiry.getTime()) && providerExpiry < cap
        ? providerExpiry
        : cap;
    if (expiresAt <= now) return { kind: "not_eligible", reason: "score_expired", details };

    return {
      kind: "verified",
      identity: {
        wallet: wallet.toLowerCase(),
        nullifier: `${this.cfg.scorerId}:${wallet.toLowerCase()}`,
        expiresAt,
        summary: { score, requiredScore: this.cfg.minScore, scorerId: this.cfg.scorerId },
      },
    };
  }
}
