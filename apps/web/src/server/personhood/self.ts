import { DefaultConfigStore, SelfBackendVerifier, type AttestationId } from "@selfxyz/core";
import { getUniversalLink, SelfAppBuilder } from "@selfxyz/common/utils/appType";
import { z } from "zod";

import {
  PersonhoodProviderError,
  type PersonhoodProvider,
  type StartResult,
  type VerifiedIdentity,
} from "./types";

/**
 * Self Protocol (self.xyz). Flow:
 *  1. We build a SelfApp request (scope, our callback endpoint, userId = wallet) and return its
 *     universal link; the mobile app opens it in the Self app.
 *  2. The user scans their passport's NFC chip in Self, which posts a zero-knowledge proof to our
 *     callback: { attestationId, proof, publicSignals, userContextData }.
 *  3. SelfBackendVerifier checks the proof against Self's on-chain registry (Celo) and returns the
 *     scope-specific nullifier. We request no disclosures, so no passport data is revealed.
 */
export interface SelfConfig {
  appName: string;
  /** App scope, max 31 ASCII chars. Must match between request and verifier. */
  scope: string;
  /** Public https URL of POST /api/personhood/self/callback. */
  endpoint: string;
  /** Use Self's staging hub (mock passports). Testnet/dev only. */
  mockPassport: boolean;
  /** Where the Self app sends the user back, e.g. seenit://personhood. */
  deeplinkCallback: string;
  ttlDays: number;
}

/** The subset of SelfBackendVerifier we use (lets tests inject a fake). */
export interface SelfProofVerifier {
  verify(
    attestationId: AttestationId,
    proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] },
    publicSignals: string[],
    userContextData: string,
  ): Promise<{
    attestationId: number;
    isValidDetails: { isValid: boolean };
    discloseOutput: { nullifier: string };
    userData: { userIdentifier: string };
  }>;
}

/** Passport only (NFC). Other Self document types can be enabled here later. */
const ALLOWED_ATTESTATIONS = new Map<AttestationId, boolean>([[1, true]]);

const big = z.union([z.string(), z.number()]).transform(String);
const callbackBody = z.object({
  attestationId: z.literal(1),
  proof: z.object({
    a: z.tuple([big, big]),
    b: z.tuple([z.tuple([big, big]), z.tuple([big, big])]),
    c: z.tuple([big, big]),
  }),
  publicSignals: z.array(big).min(1).max(64),
  userContextData: z.string().regex(/^(0x)?[0-9a-fA-F]+$/),
});

export class SelfProvider implements PersonhoodProvider {
  readonly id = "self" as const;
  readonly tier = 2 as const;
  readonly onchainProvider = 2; // PersonhoodRegistry.Provider.Self
  readonly displayName = "Self (passport NFC)";
  readonly flow = "redirect" as const;
  private verifier?: SelfProofVerifier;

  constructor(
    private readonly cfg: SelfConfig,
    verifier?: SelfProofVerifier,
  ) {
    this.verifier = verifier;
  }

  private getVerifier(): SelfProofVerifier {
    // Lazy: SelfBackendVerifier creates an RPC provider for Self's hub on Celo.
    this.verifier ??= new SelfBackendVerifier(
      this.cfg.scope,
      this.cfg.endpoint,
      this.cfg.mockPassport,
      ALLOWED_ATTESTATIONS,
      new DefaultConfigStore({}), // no age / country / OFAC rules, and no disclosures
      "hex",
    ) as unknown as SelfProofVerifier;
    return this.verifier;
  }

  async start({
    wallet,
    sessionId,
  }: {
    wallet: `0x${string}`;
    sessionId: string;
  }): Promise<StartResult> {
    const app = new SelfAppBuilder({
      appName: this.cfg.appName,
      scope: this.cfg.scope,
      endpoint: this.cfg.endpoint,
      endpointType: this.cfg.mockPassport ? "staging_https" : "https",
      userId: wallet.toLowerCase(),
      userIdType: "hex",
      devMode: this.cfg.mockPassport,
      disclosures: {},
      deeplinkCallback: `${this.cfg.deeplinkCallback}?provider=self&session=${sessionId}`,
    }).build();
    return { kind: "redirect", url: getUniversalLink(app) };
  }

  async handleCallback(payload: unknown, now: Date): Promise<VerifiedIdentity> {
    const parsed = callbackBody.safeParse(payload);
    if (!parsed.success)
      throw new PersonhoodProviderError("invalid_payload", "Malformed Self proof payload");
    const { attestationId, proof, publicSignals, userContextData } = parsed.data;

    let result: Awaited<ReturnType<SelfProofVerifier["verify"]>>;
    try {
      result = await this.getVerifier().verify(
        attestationId,
        proof as never,
        publicSignals,
        userContextData.replace(/^0x/, ""),
      );
    } catch (err) {
      // ConfigMismatchError / RegistryContractError etc. Do not echo internals.
      const name = err instanceof Error ? err.name : "Error";
      throw new PersonhoodProviderError("invalid_proof", `Self proof rejected (${name})`);
    }
    if (!result.isValidDetails.isValid)
      throw new PersonhoodProviderError("invalid_proof", "Self proof is not valid");

    const nullifier = String(result.discloseOutput.nullifier ?? "");
    if (!nullifier || /^0+$/.test(nullifier))
      throw new PersonhoodProviderError("invalid_proof", "Proof has no nullifier");
    const wallet = normalizeWallet(result.userData.userIdentifier);
    if (!wallet)
      throw new PersonhoodProviderError("invalid_proof", "Proof is not bound to a wallet");

    return {
      wallet,
      nullifier: `${this.cfg.scope}:${nullifier}`,
      expiresAt: new Date(now.getTime() + this.cfg.ttlDays * 86_400_000),
      // Deliberately nothing from discloseOutput besides the nullifier (hashed elsewhere).
      summary: {
        attestationId: result.attestationId,
        document: "passport",
        mock: this.cfg.mockPassport,
      },
    };
  }

  callbackResponse(ok: boolean, reason?: string) {
    return ok ? { status: "success", result: true } : { status: "error", result: false, reason };
  }
}

function normalizeWallet(id: string): string | null {
  const hex = id.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{1,40}$/.test(hex)) return null;
  return `0x${hex.padStart(40, "0")}`;
}
