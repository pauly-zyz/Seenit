// @vitest-environment node
import { apiKeys, eq, funders, missions, payouts, submissions } from "@seenit/db";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as nonceRoute } from "@/app/api/auth/nonce/route";
import { POST as contributorVerify } from "@/app/api/auth/verify/route";
import { DELETE as revokeKey } from "@/app/api/funder/api-keys/[id]/route";
import { GET as listKeys, POST as createKey } from "@/app/api/funder/api-keys/route";
import { POST as logout } from "@/app/api/funder/auth/logout/route";
import { POST as verify } from "@/app/api/funder/auth/verify/route";
import { GET as me } from "@/app/api/funder/me/route";
import { GET as exportRoute } from "@/app/api/missions/[id]/export/route";
import { POST as refund } from "@/app/api/missions/[id]/refund/route";
import { GET as listMissions, POST as createMission } from "@/app/api/missions/route";

import { cell } from "../domain/export";
import {
  call,
  createHarness,
  seedActiveMission,
  seedContributor,
  seedFunder,
  type Harness,
} from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

/** Dashboard sign-in; returns the Cookie header to send. */
async function signIn(account = privateKeyToAccount(generatePrivateKey())) {
  const { json } = await call(nonceRoute);
  const message = createSiweMessage({
    address: account.address,
    chainId: 31337,
    domain: "seenit.test",
    nonce: json.nonce,
    uri: "https://seenit.test/dashboard",
    version: "1",
    issuedAt: h.now,
  });
  const res = await call(verify, {
    body: { message, signature: await account.signMessage({ message }) },
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]!;
  return { res, account, cookie, setCookie };
}

const csrf = { "x-seenit-csrf": "1" };

describe("dashboard sign-in", () => {
  it("creates the funder on first sign-in and reuses it after", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const first = await signIn(account);
    expect(first.res.status).toBe(200);
    expect(first.setCookie).toMatch(
      /^seenit_funder_session=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict/,
    );
    expect(first.res.json.funder.wallet).toBe(account.address.toLowerCase());
    const again = await signIn(account);
    expect(again.res.json.funder.id).toBe(first.res.json.funder.id);
    expect(await h.db.select().from(funders)).toHaveLength(1);

    const who = await call(me, { headers: { cookie: first.cookie } });
    expect(who.json).toMatchObject({
      funder: { id: first.res.json.funder.id },
      meta: { chainId: 31337 },
    });
  });

  it("rejects bad signatures and contributor sessions", async () => {
    const { json } = await call(nonceRoute);
    const account = privateKeyToAccount(generatePrivateKey());
    const message = createSiweMessage({
      address: account.address,
      chainId: 31337,
      domain: "seenit.test",
      nonce: json.nonce,
      uri: "https://seenit.test",
      version: "1",
      issuedAt: h.now,
    });
    const bad = await call(verify, {
      body: {
        message,
        signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message }),
      },
    });
    expect(bad.status).toBe(401);

    // A contributor session cookie is not a funder session.
    const n = await call(nonceRoute);
    const m2 = createSiweMessage({
      ...{
        address: account.address,
        chainId: 31337,
        domain: "seenit.test",
        uri: "https://seenit.test",
        version: "1" as const,
        issuedAt: h.now,
      },
      nonce: n.json.nonce,
    });
    const c = await call(contributorVerify, {
      body: { message: m2, signature: await account.signMessage({ message: m2 }) },
    });
    const contributorCookie = c.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call(me, { headers: { cookie: contributorCookie } })).status).toBe(401);
  });

  it("logs out", async () => {
    const { cookie } = await signIn();
    const out = await call(logout, { method: "POST", headers: { cookie, ...csrf } });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(me, { headers: { cookie } })).status).toBe(401);
  });
});

describe("cookie auth on funder endpoints", () => {
  const spec = () => ({
    title: "Is Luna Bakery open?",
    instructions: "Photograph the entrance and any notice.",
    mediaType: "photo",
    location: { lat: -6.175, lng: 106.827 },
    radiusMeters: 100,
    rewardPerSubmission: "2000000",
    maxSubmissions: 3,
    deadline: new Date(h.now.getTime() + 86_400_000).toISOString(),
    outputSchema: { type: "object", properties: { is_open: { type: "boolean" } } },
  });

  it("requires the CSRF header on writes made with the session cookie", async () => {
    const { cookie } = await signIn();
    const blocked = await call(createMission, { headers: { cookie }, body: spec() });
    expect(blocked.status).toBe(403);
    const ok = await call(createMission, { headers: { cookie, ...csrf }, body: spec() });
    expect(ok.status).toBe(201);
    // Reads don't need it; API keys never do.
    expect((await call(listMissions, { headers: { cookie } })).json.missions).toHaveLength(1);
  });
});

describe("API keys", () => {
  it("creates (full key once), lists prefixes, and revokes", async () => {
    const { cookie } = await signIn();
    const created = await call(createKey, {
      headers: { cookie, ...csrf },
      body: { name: "my agent" },
    });
    expect(created.status).toBe(201);
    expect(created.json.key).toMatch(/^sk_/);
    expect(created.json.prefix).toBe(created.json.key.slice(0, 10));

    const list = await call(listKeys, { headers: { cookie } });
    expect(list.json.keys).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(created.json.key);
    expect(list.json.keys[0]).toMatchObject({
      name: "my agent",
      prefix: created.json.prefix,
      revokedAt: null,
    });

    // The key works for the API...
    expect((await call(listMissions, { apiKey: created.json.key })).status).toBe(200);
    // ...but can't manage keys (dashboard session only).
    expect((await call(listKeys, { apiKey: created.json.key })).status).toBe(401);

    const revoked = await call(revokeKey, {
      method: "DELETE",
      headers: { cookie, ...csrf },
      params: { id: created.json.id },
    });
    expect(revoked.json.revokedAt).not.toBeNull();
    expect((await call(listMissions, { apiKey: created.json.key })).status).toBe(401);
  });

  it("can't revoke another funder's key", async () => {
    const other = await seedFunder(h.db, "Other");
    const [key] = await h.db.select().from(apiKeys).where(eq(apiKeys.funderId, other.funder.id));
    const { cookie } = await signIn();
    const res = await call(revokeKey, {
      method: "DELETE",
      headers: { cookie, ...csrf },
      params: { id: key!.id },
    });
    expect(res.status).toBe(404);
    expect((await call(listMissions, { apiKey: other.key })).status).toBe(200);
  });
});

describe("GET /api/missions (list with escrow)", () => {
  it("summarizes funded, paid, in-review and unused amounts", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now, { maxCaptures: 4 });
    const [a, b] = [await seedContributor(h.db, h.now), await seedContributor(h.db, h.now)];
    const [acc] = await h.db
      .insert(submissions)
      .values([
        {
          missionId: m.id,
          contributorId: a.user.id,
          mediaKey: "k1",
          mediaType: "photo",
          status: "accepted",
          onchainId: 1n,
        },
        {
          missionId: m.id,
          contributorId: b.user.id,
          mediaKey: "k2",
          mediaType: "photo",
          status: "needs_review",
          onchainId: 2n,
        },
      ])
      .returning();
    await h.db.insert(payouts).values({
      submissionId: acc!.id,
      contributorId: a.user.id,
      amount: "1900000",
      fee: "100000",
      txHash: "0xp",
    });

    const res = await call(listMissions, { apiKey: key });
    expect(res.json.token).toEqual({ symbol: "USDG", decimals: 6 });
    expect(res.json.missions[0]).toMatchObject({
      id: m.id,
      submissions: { accepted: 1, needsReview: 1 },
      escrow: {
        funded: "8000000",
        paidOut: "2000000",
        paidToContributors: "1900000",
        platformFees: "100000",
        inReview: "2000000",
        unused: "4000000",
        held: "6000000",
        returned: "0",
        expired: false,
        refundable: false,
      },
    });
  });
});

describe("POST /api/missions/:id/refund", () => {
  it("refunds unused slots after the deadline through the operator", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const early = await call(refund, { method: "POST", apiKey: key, params: { id: m.id } });
    expect(early.status).toBe(409);
    expect(h.chain.callsTo("refundMission")).toHaveLength(0);

    h.advance(25 * 3600_000);
    const list = await call(listMissions, { apiKey: key });
    expect(list.json.missions[0].escrow).toMatchObject({ expired: true, refundable: true });

    const res = await call(refund, { method: "POST", apiKey: key, params: { id: m.id } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ refunded: "4000000", mission: { status: "refunded" } });
    expect(h.chain.callsTo("refundMission")[0]!.args).toEqual([m.onchainId]);
    expect((await h.db.query.missions.findFirst({ where: eq(missions.id, m.id) }))!.status).toBe(
      "refunded",
    );

    const again = await call(refund, { method: "POST", apiKey: key, params: { id: m.id } });
    expect(again.json.refunded).toBeNull();
    expect(h.chain.callsTo("refundMission")).toHaveLength(1);
  });

  it("maps on-chain reverts", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    h.advance(25 * 3600_000);
    h.chain.failNext("refundMission", "MissionNotOpen");
    expect((await call(refund, { method: "POST", apiKey: key, params: { id: m.id } })).status).toBe(
      409,
    );
  });
});

describe("GET /api/missions/:id/export", () => {
  async function seeded() {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now, {
      outputSchema: {
        type: "object",
        properties: { is_open: { type: "boolean" }, note: { type: "string" } },
      },
    });
    const [a, b] = [await seedContributor(h.db, h.now), await seedContributor(h.db, h.now)];
    const ai = (answer: unknown, confidence: number) => ({
      answer,
      confidence,
      reasoning: 'Sign, "OPEN"',
      needsReview: false,
      reviewReasons: [],
    });
    await h.db.insert(submissions).values([
      {
        missionId: m.id,
        contributorId: a.user.id,
        mediaKey: "submissions/a/original",
        mediaType: "photo",
        status: "accepted",
        onchainId: 11n,
        lat: -6.1754,
        lng: 106.8272,
        capturedAt: h.now,
        blurredFrameKeys: ["blurred/a/frame-0.jpg"],
        aiResult: ai({ is_open: true, note: '=HYPERLINK("http://evil")' }, 0.93),
        recordTxHash: "0xrec",
      },
      {
        missionId: m.id,
        contributorId: b.user.id,
        mediaKey: "submissions/b/original",
        mediaType: "photo",
        status: "needs_review",
        onchainId: 12n,
        aiResult: ai(null, 0.2),
      },
    ]);
    return { key, m };
  }

  it("exports accepted results as CSV with flattened answers and formula-safe cells", async () => {
    const { key, m } = await seeded();
    const res = await exportRoute(
      new Request("http://localhost/?format=csv", { headers: { "x-api-key": key } }),
      { params: Promise.resolve({ id: m.id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="seenit-.+-accepted\.csv"/,
    );
    const [head, row, ...rest] = (await res.text()).trimEnd().split("\r\n");
    expect(rest).toHaveLength(0); // needs_review rows are not in the accepted export
    const cols = head!.split(",");
    expect(cols.slice(0, 6)).toEqual([
      "submission_id",
      "status",
      "captured_at",
      "lat",
      "lng",
      "gps_accuracy_m",
    ]);
    expect(cols.slice(6, 8).sort()).toEqual(["answer.is_open", "answer.note"]);
    expect(cols[8]).toBe("confidence");
    expect(row).toContain(",accepted,");
    expect(row).toContain(",-6.1754,106.8272,,");
    expect(row).toContain(",true,");
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`); // formula neutralized
    expect(row).toContain(`"Sign, ""OPEN"""`);
    expect(row).toContain("blurred/a/frame-0.jpg");
    expect(row).not.toContain("/original");
  });

  it("exports JSON, optionally with every reviewable submission, never the original", async () => {
    const { key, m } = await seeded();
    const res = await call(exportRoute, {
      apiKey: key,
      params: { id: m.id },
      path: "/?format=json&scope=all",
    });
    expect(res.json.count).toBe(2);
    expect(res.json.results[0]).toMatchObject({
      status: "accepted",
      answer: { is_open: true },
      confidence: 0.93,
      location: { lat: -6.1754, lng: 106.8272 },
      media: [expect.stringContaining("blurred/a/frame-0.jpg")],
    });
    expect(JSON.stringify(res.json)).not.toContain("/original");
    const other = await seedFunder(h.db, "Other");
    expect((await call(exportRoute, { apiKey: other.key, params: { id: m.id } })).status).toBe(404);
  });

  it("escapes CSV cells", () => {
    expect(cell('a,"b"')).toBe('"a,""b"""');
    expect(cell("=1+1")).toBe("'=1+1");
    expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(cell(-5)).toBe("-5");
    expect(cell({ a: 1 })).toBe('"{""a"":1}"');
    expect(cell(null)).toBe("");
  });
});
