// @vitest-environment node
import { eq, personhoodAttestations, users, verificationSessions } from "@seenit/db";
import { keccak256, stringToBytes } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as callback } from "@/app/api/personhood/[provider]/callback/route";
import { POST as start } from "@/app/api/personhood/[provider]/start/route";
import { GET as sessionRoute } from "@/app/api/personhood/sessions/[id]/route";
import { GET as status } from "@/app/api/personhood/status/route";
import { POST as uploadUrl } from "@/app/api/submissions/upload-url/route";

import { nullifierHash } from "../domain/personhood";
import type { PersonhoodProvider } from "../personhood/types";
import {
  call,
  createHarness,
  SELF_TEST_CONFIG,
  seedActiveMission,
  seedContributor,
  seedFunder,
  type Harness,
} from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const startFor = (provider: string, token: string) =>
  call(start, { path: `/api/personhood/${provider}/start`, token, params: { provider }, body: {} });

const selfPayload = (overrides: Record<string, unknown> = {}) => ({
  attestationId: 1,
  proof: {
    a: ["1", "2"],
    b: [
      ["3", "4"],
      ["5", "6"],
    ],
    c: ["7", "8"],
  },
  publicSignals: ["1", "2", "3"],
  userContextData: "ab".repeat(96),
  ...overrides,
});
const postSelfCallback = (body: unknown) =>
  call(callback, { path: "/api/personhood/self/callback", params: { provider: "self" }, body });

/** Everything persisted about a user's personhood, as one string. */
async function storedText(userId: string) {
  const rows = await h.db
    .select()
    .from(personhoodAttestations)
    .where(eq(personhoodAttestations.userId, userId));
  const sessions = await h.db
    .select()
    .from(verificationSessions)
    .where(eq(verificationSessions.userId, userId));
  return JSON.stringify({ rows, sessions });
}

// ------------------------------------------------------------------------------------------------

describe("Tier 1: Human Passport", () => {
  it("attests on-chain when the score reaches the threshold", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("27.43100");
    const res = await startFor("human_passport", c.token);

    expect(res.status).toBe(200);
    expect(res.json.status).toBe("verified");
    expect(res.json.tier).toBe(1);
    expect(res.json.attestation).toMatchObject({
      provider: "human_passport",
      tier: 1,
      state: "active",
    });

    // API call: v2 endpoint, scorer id, wallet, X-API-Key header
    const [apiCall] = h.passportApi.calls;
    expect(apiCall!.url).toBe(`https://api.passport.test/v2/stamps/42/score/${c.account.address}`);
    expect(apiCall!.headers["x-api-key"]).toBe("hp-test-key");

    // On-chain: Provider.HumanPassport, hashed nullifier, expiry from Passport (earlier than 90 days)
    const [att] = h.registry.attests;
    expect(att!.wallet).toBe(c.account.address);
    expect(att!.provider).toBe(1);
    expect(att!.nullifierHash).toBe(nullifierHash("human_passport", `42:${c.user.wallet}`));
    expect(att!.expiresAt).toBe(BigInt(Date.parse("2027-01-17T09:00:00Z") / 1000));

    const user = await h.db.query.users.findFirst({ where: eq(users.id, c.user.id) });
    expect(user!.tier).toBe(1);
    const stored = await storedText(c.user.id);
    expect(stored).toContain('"score":27.431');
    expect(stored).not.toContain("Google"); // stamp details are not kept
  });

  it("caps the attestation at the configured TTL", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("30", { expiration_timestamp: "2030-01-01T00:00:00Z" });
    await startFor("human_passport", c.token);
    const ttlEnd = BigInt(Math.floor((h.now.getTime() + 90 * 86_400_000) / 1000));
    expect(h.registry.attests[0]!.expiresAt).toBe(ttlEnd);
  });

  it("returns 422 with the score and how to improve it when below threshold", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("12.5");
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(422);
    expect(res.json.error.details).toMatchObject({
      reason: "score_too_low",
      score: 12.5,
      requiredScore: 20,
    });
    expect(res.json.error.details.getStampsUrl).toMatch(/^https:\/\//);
    expect(h.registry.attests).toHaveLength(0);
    const [session] = await h.db.select().from(verificationSessions);
    expect(session).toMatchObject({ status: "failed", error: "score_too_low" });
  });

  it("treats a null score or Passport error as not eligible", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score(null, { error: "Unable to get score" });
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(422);
    expect(res.json.error.details.reason).toBe("score_error");
  });

  it("maps provider outages to 502 and bad requests to 400", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.next = { status: 503, body: {} };
    expect((await startFor("human_passport", c.token)).status).toBe(502);
    h.passportApi.next = "network_error";
    expect((await startFor("human_passport", c.token)).status).toBe(502);
    h.passportApi.next = { status: 401, body: { detail: "Invalid API key" } };
    expect((await startFor("human_passport", c.token)).status).toBe(400);
    h.passportApi.next = { status: 200, body: { unexpected: true } };
    expect((await startFor("human_passport", c.token)).status).toBe(400);
  });

  it("re-verifying renews the same attestation", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("25");
    await startFor("human_passport", c.token);
    h.advance(86_400_000);
    h.passportApi.score("31");
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(200);
    const rows = await h.db
      .select()
      .from(personhoodAttestations)
      .where(eq(personhoodAttestations.userId, c.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toMatchObject({ score: 31 });
    expect(h.registry.attests).toHaveLength(2);
    expect(h.registry.attests[0]!.nullifierHash).toBe(h.registry.attests[1]!.nullifierHash);
  });

  it("keeps the verification pending when the on-chain write fails, and recovers on retry", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("25");
    h.registry.failNext();
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(502);
    expect(res.json.error.details.reason).toBe("attest_failed");

    const st = await call(status, { token: c.token });
    expect(st.json.tier).toBe(0); // not on-chain yet, so not counted
    expect(st.json.attestations[0].state).toBe("pending_onchain");

    expect((await startFor("human_passport", c.token)).status).toBe(200);
    expect((await call(status, { token: c.token })).json.tier).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------

describe("Tier 2: Self", () => {
  async function selfSession() {
    const c = await seedContributor(h.db, h.now, { tier: 1 });
    const res = await startFor("self", c.token);
    h.selfVerifier.next = {
      valid: true,
      nullifier: "98765432101234567890",
      userIdentifier: c.user.wallet,
    };
    return { c, res };
  }

  it("returns a Self universal link bound to the wallet, with no disclosures", async () => {
    const { c, res } = await selfSession();
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("pending");
    const url = new URL(res.json.url);
    expect(url.origin).toBe("https://redirect.self.xyz");
    const app = JSON.parse(url.searchParams.get("selfApp")!);
    expect(app).toMatchObject({
      scope: SELF_TEST_CONFIG.scope,
      endpoint: SELF_TEST_CONFIG.endpoint,
      endpointType: "staging_https",
      userIdType: "hex",
      userId: c.user.wallet.slice(2),
      disclosures: {},
    });
    expect(app.deeplinkCallback).toBe(
      `seenit://personhood?provider=self&session=${res.json.sessionId}`,
    );
  });

  it("verifies the proof callback and attests Tier 2 on-chain", async () => {
    const { c, res } = await selfSession();
    const cb = await postSelfCallback(selfPayload());
    expect(cb.status).toBe(200);
    expect(cb.json).toEqual({ status: "success", result: true });

    // verifier got the proof as sent (userContextData without 0x)
    const [args] = h.selfVerifier.calls;
    expect(args![0]).toBe(1);
    expect(args![3]).toBe("ab".repeat(96));

    const [att] = h.registry.attests;
    expect(att!.provider).toBe(2);
    expect(att!.nullifierHash).toBe(nullifierHash("self", "seenit-test:98765432101234567890"));

    const poll = await call(sessionRoute, { token: c.token, params: { id: res.json.sessionId } });
    expect(poll.json).toMatchObject({ status: "verified", tier: 2 });
  });

  it("never stores passport data or the raw nullifier", async () => {
    const { c } = await selfSession();
    await postSelfCallback(selfPayload());
    const stored = await storedText(c.user.id);
    expect(stored).not.toContain("SHOULD NOT LEAK");
    expect(stored).not.toContain("X1234567");
    expect(stored).not.toContain("98765432101234567890");
    expect(stored).toContain(
      keccak256(stringToBytes("seenit:self:seenit-test:98765432101234567890")),
    );
  });

  it("rejects an invalid proof", async () => {
    const { c, res } = await selfSession();
    h.selfVerifier.next = { valid: false, nullifier: "1", userIdentifier: c.user.wallet };
    const cb = await postSelfCallback(selfPayload());
    expect(cb.status).toBe(400);
    expect(cb.json).toEqual({ status: "error", result: false, reason: "invalid_proof" });
    expect(h.registry.attests).toHaveLength(0);
    // the session stays pending: the user can retry in the Self app
    const poll = await call(sessionRoute, { token: c.token, params: { id: res.json.sessionId } });
    expect(poll.json.status).toBe("pending");
  });

  it("rejects when the verifier throws (scope / config mismatch, bad root)", async () => {
    await selfSession();
    h.selfVerifier.next = new Error("ConfigMismatchError");
    const cb = await postSelfCallback(selfPayload());
    expect(cb.json.reason).toBe("invalid_proof");
  });

  it("rejects malformed payloads before calling the verifier", async () => {
    await selfSession();
    expect((await postSelfCallback({ attestationId: 1 })).json.reason).toBe("invalid_payload");
    expect((await postSelfCallback(selfPayload({ attestationId: 3 }))).json.reason).toBe(
      "invalid_payload",
    );
    expect((await postSelfCallback("nope")).status).toBe(400);
    expect(h.selfVerifier.calls).toHaveLength(0);
  });

  it("rejects proofs without a pending session or for unknown wallets", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 1 });
    h.selfVerifier.next = { valid: true, nullifier: "55", userIdentifier: c.user.wallet };
    expect((await postSelfCallback(selfPayload())).json.reason).toBe("no_pending_session");

    h.selfVerifier.next = { valid: true, nullifier: "55", userIdentifier: "0x" + "9".repeat(40) };
    expect((await postSelfCallback(selfPayload())).json.reason).toBe("unknown_wallet");
  });

  it("rejects an expired session", async () => {
    await selfSession();
    h.advance(16 * 60_000);
    expect((await postSelfCallback(selfPayload())).json.reason).toBe("no_pending_session");
  });
});

// ------------------------------------------------------------------------------------------------

describe("One identity, one account", () => {
  it("rejects a Self nullifier already bound to another wallet", async () => {
    const a = await seedContributor(h.db, h.now, { tier: 1 });
    const b = await seedContributor(h.db, h.now, { tier: 1 });

    await startFor("self", a.token);
    h.selfVerifier.next = { valid: true, nullifier: "777", userIdentifier: a.user.wallet };
    expect((await postSelfCallback(selfPayload())).status).toBe(200);

    const { json } = await startFor("self", b.token);
    h.selfVerifier.next = { valid: true, nullifier: "777", userIdentifier: b.user.wallet };
    const cb = await postSelfCallback(selfPayload());
    expect(cb.status).toBe(400);
    expect(cb.json.reason).toBe("nullifier_in_use");
    expect(h.registry.attests).toHaveLength(1);

    const poll = await call(sessionRoute, { token: b.token, params: { id: json.sessionId } });
    expect(poll.json).toMatchObject({ status: "failed", error: "nullifier_in_use", tier: 1 });
  });

  it("rejects a different identity for an already verified account", async () => {
    const a = await seedContributor(h.db, h.now, { tier: 1 });
    await startFor("self", a.token);
    h.selfVerifier.next = { valid: true, nullifier: "111", userIdentifier: a.user.wallet };
    await postSelfCallback(selfPayload());

    await startFor("self", a.token);
    h.selfVerifier.next = { valid: true, nullifier: "222", userIdentifier: a.user.wallet };
    expect((await postSelfCallback(selfPayload())).json.reason).toBe("different_identity");
  });

  it("maps an on-chain NullifierBoundToOtherWallet revert to 409 and drops the row", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("25");
    h.registry.failNext("NullifierBoundToOtherWallet");
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(409);
    expect(res.json.error.details.reason).toBe("nullifier_in_use");
    expect(
      await h.db
        .select()
        .from(personhoodAttestations)
        .where(eq(personhoodAttestations.userId, c.user.id)),
    ).toHaveLength(0);
  });

  it("refuses to re-verify a revoked identity", async () => {
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    h.passportApi.score("25");
    await startFor("human_passport", c.token);
    await h.db
      .update(personhoodAttestations)
      .set({ revokedAt: h.now })
      .where(eq(personhoodAttestations.userId, c.user.id));
    const res = await startFor("human_passport", c.token);
    expect(res.status).toBe(403);
    expect(res.json.error.details.reason).toBe("revoked");
  });
});

// ------------------------------------------------------------------------------------------------

describe("GET /api/personhood/status", () => {
  it("explains each tier and how many missions it opens", async () => {
    const { funder } = await seedFunder(h.db);
    await seedActiveMission(h.db, funder.id, h.now, { minTier: 1 });
    await seedActiveMission(h.db, funder.id, h.now, { minTier: 1 });
    await seedActiveMission(h.db, funder.id, h.now, { minTier: 2 });
    await seedActiveMission(h.db, funder.id, h.now, { minTier: 2, status: "cancelled" });
    const c = await seedContributor(h.db, h.now, { tier: 1 });

    const res = await call(status, { token: c.token });
    expect(res.status).toBe(200);
    expect(res.json.tier).toBe(1);
    expect(res.json.missionsOpenToYou).toBe(2);
    const [t1, t2] = res.json.tiers;
    expect(t1).toMatchObject({
      tier: 1,
      unlocked: true,
      provider: "human_passport",
      activeMissions: 2,
    });
    expect(t1.unlocks).toBe("Missions paying up to 5.00 USDG per capture.");
    expect(t2).toMatchObject({ tier: 2, unlocked: false, provider: "self", activeMissions: 3 });
    expect(res.json.providers.map((p: { id: string }) => p.id)).toEqual(["human_passport", "self"]);
  });

  it("requires a session", async () => {
    expect((await call(status, {})).status).toBe(401);
  });
});

describe("tier gates missions end to end", () => {
  it("a contributor becomes eligible for a Tier 2 mission after Self verification", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now, { minTier: 2 });
    const c = await seedContributor(h.db, h.now, { tier: 1 });
    const body = {
      missionId: m.id,
      mediaType: "photo",
      contentType: "image/jpeg",
      contentLength: 1000,
      gps: { lat: m.lat, lng: m.lng, accuracyMeters: 5 },
    };
    expect((await call(uploadUrl, { token: c.token, body })).status).toBe(403);

    await startFor("self", c.token);
    h.selfVerifier.next = { valid: true, nullifier: "42", userIdentifier: c.user.wallet };
    await postSelfCallback(selfPayload());
    expect((await call(uploadUrl, { token: c.token, body })).status).toBe(200);
  });
});

describe("provider routing (adapter pattern)", () => {
  it("unknown or disabled providers are 404", async () => {
    const c = await seedContributor(h.db, h.now);
    expect((await startFor("world_id", c.token)).status).toBe(404);
    h.personhood.delete("self");
    expect((await startFor("self", c.token)).status).toBe(404);
  });

  it("a new provider plugs in without touching routes or the flow", async () => {
    // Stand-in for a future World ID adapter, registered under an existing id for the test.
    const fake: PersonhoodProvider = {
      id: "human_passport",
      tier: 1,
      onchainProvider: 1,
      displayName: "Fake World ID",
      flow: "redirect",
      start: async () => ({ kind: "redirect", url: "https://id.example/verify" }),
      handleCallback: async (payload, now) => ({
        wallet: (payload as { wallet: string }).wallet,
        nullifier: "world-nullifier",
        expiresAt: new Date(now.getTime() + 86_400_000),
        summary: { level: "orb" },
      }),
      callbackResponse: (ok) => ({ ok }),
    };
    h.personhood.set("human_passport", fake);
    const c = await seedContributor(h.db, h.now, { tier: 0 });
    const res = await startFor("human_passport", c.token);
    expect(res.json).toMatchObject({ status: "pending", url: "https://id.example/verify" });
    const cb = await call(callback, {
      path: "/api/personhood/human_passport/callback",
      params: { provider: "human_passport" },
      body: { wallet: c.user.wallet },
    });
    expect(cb.json).toEqual({ ok: true });
    expect((await call(status, { token: c.token })).json.tier).toBe(1);
  });
});
