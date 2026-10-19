// @vitest-environment node
import { users } from "@seenit/db";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as nonceRoute } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as uploadUrl } from "@/app/api/submissions/upload-url/route";

import { call, createHarness, type Harness } from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

async function signIn(
  account = privateKeyToAccount(generatePrivateKey()),
  overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {},
) {
  const { json } = await call(nonceRoute, { path: "/api/auth/nonce" });
  const message = createSiweMessage({
    address: account.address,
    chainId: 31337,
    domain: "seenit.test",
    nonce: json.nonce,
    uri: "https://seenit.test",
    version: "1",
    issuedAt: h.now,
    ...overrides,
  });
  const signature = await account.signMessage({ message });
  return { account, message, signature, nonce: json.nonce as string };
}

describe("GET /api/auth/nonce", () => {
  it("returns a nonce with domain and chain", async () => {
    const { status, json, headers } = await call(nonceRoute, { path: "/api/auth/nonce" });
    expect(status).toBe(200);
    expect(json.nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
    expect(json.domain).toBe("seenit.test");
    expect(json.chainId).toBe(31337);
    expect(headers.get("x-request-id")).toBeTruthy();
  });

  it("is rate limited per IP", async () => {
    for (let i = 0; i < 20; i++)
      await call(nonceRoute, { path: "/api/auth/nonce", ip: "198.51.100.1" });
    const res = await call(nonceRoute, { path: "/api/auth/nonce", ip: "198.51.100.1" });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // a different IP is unaffected
    expect((await call(nonceRoute, { path: "/api/auth/nonce", ip: "198.51.100.2" })).status).toBe(
      200,
    );
  });
});

describe("POST /api/auth/verify", () => {
  it("signs in, creates the user and a usable session", async () => {
    const { account, message, signature } = await signIn();
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(200);
    expect(res.json.user.wallet).toBe(account.address.toLowerCase());
    expect(res.json.token).toBeTruthy();
    expect(res.headers.get("set-cookie")).toMatch(
      /seenit_session=.+HttpOnly; Secure; SameSite=Lax/,
    );

    const rows = await h.db.select().from(users);
    expect(rows).toHaveLength(1);

    // the session authenticates contributor routes (body is invalid, so we expect 400, not 401)
    const authed = await call(uploadUrl, {
      path: "/api/submissions/upload-url",
      token: res.json.token,
      body: {},
    });
    expect(authed.status).toBe(400);
  });

  it("accepts the session from the cookie too", async () => {
    const { message, signature } = await signIn();
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    const authed = await call(uploadUrl, {
      path: "/api/submissions/upload-url",
      headers: { cookie: `other=1; seenit_session=${res.json.token}` },
      body: {},
    });
    expect(authed.status).toBe(400);
  });

  it("signing in twice reuses the same user", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    for (let i = 0; i < 2; i++) {
      const { message, signature } = await signIn(account);
      expect(
        (await call(verify, { path: "/api/auth/verify", body: { message, signature } })).status,
      ).toBe(200);
    }
    expect(await h.db.select().from(users)).toHaveLength(1);
  });

  it("rejects a reused nonce", async () => {
    const { message, signature } = await signIn();
    expect(
      (await call(verify, { path: "/api/auth/verify", body: { message, signature } })).status,
    ).toBe(200);
    const again = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(again.status).toBe(401);
    expect(again.json.error.message).toMatch(/nonce/);
  });

  it("rejects an expired nonce", async () => {
    const { message, signature } = await signIn();
    h.advance(11 * 60_000);
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(401);
  });

  it("rejects a message for another domain", async () => {
    const { message, signature } = await signIn(undefined, { domain: "evil.example" });
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toMatch(/not valid/);
  });

  it("rejects a message for another chain", async () => {
    const { message, signature } = await signIn(undefined, { chainId: 1 });
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toMatch(/chain/);
  });

  it("rejects a signature from a different wallet", async () => {
    const { message } = await signIn();
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toMatch(/Signature/);
    expect(await h.db.select().from(users)).toHaveLength(0);
  });

  it("accepts a smart-contract wallet via ERC-1271", async () => {
    const contractWallet = privateKeyToAccount(generatePrivateKey());
    const { message } = await signIn(contractWallet);
    h.chain.contractSignatureValid = true;
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    const res = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(res.status).toBe(200);
  });

  it("rejects a malformed body", async () => {
    expect((await call(verify, { path: "/api/auth/verify", body: { message: "hi" } })).status).toBe(
      400,
    );
    expect((await call(verify, { path: "/api/auth/verify", body: "{not json" })).status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session", async () => {
    const { message, signature } = await signIn();
    const { json } = await call(verify, { path: "/api/auth/verify", body: { message, signature } });
    expect(
      (await call(logout, { path: "/api/auth/logout", token: json.token, body: {} })).status,
    ).toBe(200);
    const after = await call(uploadUrl, {
      path: "/api/submissions/upload-url",
      token: json.token,
      body: {},
    });
    expect(after.status).toBe(401);
  });

  it("requires a session", async () => {
    expect((await call(logout, { path: "/api/auth/logout", body: {} })).status).toBe(401);
  });
});
