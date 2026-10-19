import {
  funders,
  missions,
  personhoodAttestations,
  users,
  type Database,
  type InferSelectModel,
} from "@seenit/db";
import { createTestDb, resetTestDb } from "@seenit/db/testing";
import pino from "pino";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { createApiKey } from "../auth/api-keys";
import { createSession } from "../auth/sessions";
import type { AppConfig } from "../config";
import { setServices, type Services } from "../services";
import { HumanPassportProvider } from "../personhood/human-passport";
import { SelfProvider } from "../personhood/self";
import type { PersonhoodProvider } from "../personhood/types";
import {
  FakeEscrowGateway,
  FakePassportApi,
  FakeRegistryGateway,
  FakeSelfVerifier,
  FakeStorage,
} from "./fakes";

export const TEST_NOW = new Date("2026-10-19T10:00:00.000Z");

export const testConfig: AppConfig = {
  logLevel: "silent",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  escrowAddress: "0x00000000000000000000000000000000000e5c20",
  registryAddress: "0x0000000000000000000000000000000000000e61",
  tokenAddress: "0x0000000000000000000000000000000000007070",
  tier1MaxReward: 5_000_000n,
  indexerStartBlock: 0n,
  siweDomain: "seenit.test",
  cronSecret: "test-cron-secret-that-is-long-enough-123",
  tokenSymbol: "USDG",
  tokenDecimals: 6,
};

export const SELF_TEST_CONFIG = {
  appName: "Seenit",
  scope: "seenit-test",
  endpoint: "https://api.seenit.test/api/personhood/self/callback",
  mockPassport: true,
  deeplinkCallback: "seenit://personhood",
  ttlDays: 365,
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** PGlite database + fake chain/storage wired in as the app's services. */
export async function createHarness() {
  const { db, close } = await createTestDb();
  let now = TEST_NOW;
  const chain = new FakeEscrowGateway(() => now);
  const storage = new FakeStorage();
  const registry = new FakeRegistryGateway();
  const passportApi = new FakePassportApi();
  const selfVerifier = new FakeSelfVerifier();
  const personhood = new Map<string, PersonhoodProvider>([
    [
      "human_passport",
      new HumanPassportProvider(
        {
          apiUrl: "https://api.passport.test",
          apiKey: "hp-test-key",
          scorerId: "42",
          minScore: 20,
          ttlDays: 90,
        },
        passportApi.fetch,
      ),
    ],
    ["self", new SelfProvider(SELF_TEST_CONFIG, selfVerifier)],
  ]);
  const services: Services = {
    db,
    chain,
    storage,
    registry,
    personhood: personhood as Services["personhood"],
    logger: pino({ level: "silent" }),
    config: testConfig,
    now: () => now,
  };
  setServices(services);

  return {
    db,
    chain,
    storage,
    registry,
    passportApi,
    selfVerifier,
    personhood,
    services,
    get now() {
      return now;
    },
    setNow(d: Date) {
      now = d;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    async reset() {
      await resetTestDb(db);
      chain.reset();
      storage.reset();
      registry.reset();
      passportApi.reset();
      selfVerifier.reset();
      now = TEST_NOW;
      setServices(services);
    },
    async close() {
      setServices(undefined);
      await close();
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Seed helpers
// ------------------------------------------------------------------------------------------------

export async function seedFunder(db: Database, name = "Acme Agent") {
  const wallet = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const [funder] = await db.insert(funders).values({ name, wallet }).returning();
  const { key } = await createApiKey(db, funder!.id);
  return { funder: funder!, key };
}

export async function seedContributor(db: Database, now: Date, opts: { tier?: 0 | 1 | 2 } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const tier = opts.tier ?? 1;
  const [user] = await db
    .insert(users)
    .values({ wallet: account.address.toLowerCase(), tier })
    .returning();
  if (tier > 0) {
    await db.insert(personhoodAttestations).values({
      userId: user!.id,
      provider: tier === 2 ? "self" : "human_passport",
      tier,
      nullifierHash: `nullifier-${account.address}`,
      expiresAt: new Date(now.getTime() + 365 * 86_400_000),
      txHash: `0x${"aa".repeat(32)}`,
    });
  }
  const { token } = await createSession(db, user!.id, now);
  return { user: user!, token, account };
}

let onchainCounter = 100n;

/** An active (funded) mission. Default: photo, 100 m around Monas, 2.00 reward, 3 captures. */
export async function seedActiveMission(
  db: Database,
  funderId: string,
  now: Date,
  overrides: Partial<InferSelectModel<typeof missions>> = {},
) {
  const onchainId = onchainCounter++;
  const [m] = await db
    .insert(missions)
    .values({
      funderId,
      title: "Is Luna Bakery open?",
      instructions: "Take one photo of the entrance and any posted notice.",
      mediaType: "photo",
      lat: -6.175392,
      lng: 106.827153,
      radiusMeters: 100,
      reward: "2000000",
      maxCaptures: 3,
      minTier: 1,
      deadline: new Date(now.getTime() + 24 * 3600_000),
      status: "active",
      outputSchema: { type: "object", properties: { is_open: { type: "boolean" } } },
      specHash: `0x${onchainId.toString(16).padStart(64, "0")}`,
      onchainId,
      chainTxHash: `0x${"ab".repeat(32)}`,
      ...overrides,
    })
    .returning();
  return m!;
}

// ------------------------------------------------------------------------------------------------
// Request helper
// ------------------------------------------------------------------------------------------------

type Handler = (req: Request, ctx?: { params: Promise<never> }) => Promise<Response>;

export async function call(
  handler: Handler,
  opts: {
    method?: string;
    path?: string;
    body?: unknown;
    token?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    ip?: string;
  } = {},
) {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.apiKey) headers.set("x-api-key", opts.apiKey);
  headers.set("x-forwarded-for", opts.ip ?? "203.0.113.7");
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const req = new Request(`http://localhost${opts.path ?? "/"}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve((opts.params ?? {}) as never) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: res.status, json, headers: res.headers };
}
