/**
 * Boots the whole Seenit stack locally for an end-to-end rehearsal:
 *   anvil (chain id 46630, like Robinhood Chain testnet) → contracts deployed with the real
 *   Deploy.s.sol → Postgres 16 → S3 emulator (SigV4-checked, stands in for R2) → fake Human
 *   Passport API → webhook receiver → the production build of apps/web (next start).
 * The worker runs in-process (see run.ts) so the AI step can be scripted without an API key.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
  parseAbi,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { startS3Emulator, type S3Emulator } from "./s3-emulator.js";

const exec = promisify(execFile);
export const ROOT = resolve(import.meta.dirname, "../../..");
const FOUNDRY = join(process.env.HOME ?? "/root", ".foundry/bin");
const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
export const CHAIN_ID = 46630;

/** anvil's default, publicly known test mnemonic. These keys hold nothing anywhere real. */
const MNEMONIC = "test test test test test test test test test test test junk";
export const account = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const keyOf = (i: number) =>
  `0x${Buffer.from(account(i).getHdKey().privateKey!).toString("hex")}` as Hex;

export const localChain = (rpcUrl: string) =>
  defineChain({
    id: CHAIN_ID,
    name: "anvil (Robinhood Chain testnet id)",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

export const ROLES = {
  deployer: 0,
  attester: 1,
  operator: 2,
  treasury: 3,
  funder: 4,
  otherFunder: 5,
} as const;

export interface Stack {
  rpcUrl: string;
  apiUrl: string;
  dbUrl: string;
  s3: S3Emulator;
  contracts: { token: Hex; registry: Hex; escrow: Hex; deployBlock: number };
  keys: Record<keyof typeof ROLES, Hex>;
  webhooks: { url: string; received: { headers: Record<string, string>; body: string }[] };
  env: Record<string, string>;
  cronSecret: string;
  log: (msg: string) => void;
  psql(sql: string): Promise<string>;
  stop(): Promise<void>;
}

async function waitFor(what: string, fn: () => Promise<boolean>, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function startStack(opts: {
  build: boolean;
  log: (m: string) => void;
}): Promise<Stack> {
  const { log } = opts;
  const work = await mkdtemp(join(tmpdir(), "seenit-e2e-"));
  const procs: ChildProcess[] = [];
  const servers: Server[] = [];
  const cleanups: (() => Promise<void>)[] = [];

  const stop = async () => {
    for (const s of servers) await new Promise((r) => s.close(() => r(null)));
    for (const p of procs.reverse()) p.kill("SIGTERM");
    for (const c of cleanups.reverse()) await c().catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    // --- Chain ------------------------------------------------------------------------------
    const anvilPort = 18545;
    const rpcUrl = `http://127.0.0.1:${anvilPort}`;
    const anvil = spawn(
      join(FOUNDRY, "anvil"),
      ["--chain-id", String(CHAIN_ID), "--port", String(anvilPort), "--silent"],
      {
        stdio: "ignore",
      },
    );
    procs.push(anvil);
    const pub = createPublicClient({ transport: http(rpcUrl) });
    await waitFor("anvil", async () => (await pub.getChainId()) === CHAIN_ID);
    log(`anvil up on chain ${CHAIN_ID}`);

    const keys = Object.fromEntries(
      Object.entries(ROLES).map(([k, i]) => [k, keyOf(i)]),
    ) as Stack["keys"];
    const contractsDir = join(ROOT, "packages/contracts");

    // Reward token: the test MockERC20 (6 decimals). On testnet this is the official stablecoin.
    const created = await exec(
      join(FOUNDRY, "forge"),
      [
        "create",
        "test/mocks/MockERC20.sol:MockERC20",
        "--rpc-url",
        rpcUrl,
        "--private-key",
        keys.deployer,
        "--broadcast",
        "--offline",
      ],
      { cwd: contractsDir },
    );
    const token = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(created.stdout)?.[1] as Hex;
    if (!token) throw new Error(`token deploy failed:\n${created.stdout}${created.stderr}`);

    // Inside Foundry's allowed fs path, in a git-ignored subfolder export-abi doesn't read.
    await mkdir(join(contractsDir, "deployments/local"), { recursive: true });
    const deploymentsFile = join(contractsDir, "deployments/local", `e2e-${process.pid}.json`);
    cleanups.push(() => rm(deploymentsFile, { force: true }));
    const deployEnv = {
      ...process.env,
      REWARD_TOKEN_ADDRESS: token,
      ADMIN_ADDRESS: account(ROLES.deployer).address,
      ADMIN_TRANSFER_DELAY: "172800",
      ATTESTER_ADDRESS: account(ROLES.attester).address,
      OPERATOR_ADDRESS: account(ROLES.operator).address,
      PAUSER_ADDRESS: account(ROLES.deployer).address,
      TREASURY_ADDRESS: account(ROLES.treasury).address,
      PLATFORM_FEE_BPS: "500",
      TIER1_MAX_REWARD: "5000000",
      REVIEW_WINDOW_SECONDS: "259200",
      DEPLOYMENTS_FILE: deploymentsFile,
    };
    const deploy = await exec(
      join(FOUNDRY, "forge"),
      [
        "script",
        "script/Deploy.s.sol",
        "--rpc-url",
        rpcUrl,
        "--private-key",
        keys.deployer,
        "--broadcast",
        "--offline",
      ],
      { cwd: contractsDir, env: deployEnv },
    );
    const deployment = JSON.parse(await readFile(deploymentsFile, "utf8")) as {
      personhoodRegistry: Hex;
      missionEscrow: Hex;
      blockNumber: number;
    };
    // forge script leaves a broadcast log for chain 46630 next to the real one: remove ours.
    await rm(join(contractsDir, "broadcast/Deploy.s.sol", String(CHAIN_ID), "run-latest.json"), {
      force: true,
    });
    log(
      `deployed with Deploy.s.sol: registry ${deployment.personhoodRegistry}, escrow ${deployment.missionEscrow}`,
    );
    if (!deploy.stdout.includes("MissionEscrow")) log(deploy.stdout);

    // Fund the funder wallet with 1,000 mock USDG.
    const chain = localChain(rpcUrl);
    const wallet = createWalletClient({
      account: account(ROLES.deployer),
      transport: http(rpcUrl),
      chain,
    });
    const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
    for (const who of [ROLES.funder, ROLES.otherFunder]) {
      const hash = await wallet.writeContract({
        address: token,
        abi: mintAbi,
        functionName: "mint",
        args: [account(who).address, 1_000_000_000n],
      });
      await pub.waitForTransactionReceipt({ hash });
    }

    // --- Postgres --------------------------------------------------------------------------
    const pgDir = join(work, "pg");
    await mkdir(pgDir, { recursive: true });
    await chmod(work, 0o755);
    await exec("chown", ["-R", "postgres", pgDir]).catch(() => undefined);
    const asPg = (bin: string, args: string[]) =>
      process.getuid?.() === 0
        ? exec("runuser", ["-u", "postgres", "--", join(PG_BIN, bin), ...args])
        : exec(join(PG_BIN, bin), args);
    await asPg("initdb", ["-D", join(pgDir, "data"), "-U", "seenit", "--auth=trust"]);
    const pgPort = 15432;
    await asPg("pg_ctl", [
      "-D",
      join(pgDir, "data"),
      "-o",
      `-p ${pgPort} -k ${pgDir} -c listen_addresses=127.0.0.1`,
      "-l",
      join(pgDir, "log"),
      "-w",
      "start",
    ]);
    cleanups.push(
      async () => void (await asPg("pg_ctl", ["-D", join(pgDir, "data"), "-m", "fast", "stop"])),
    );
    await exec("psql", [
      "-h",
      "127.0.0.1",
      "-p",
      String(pgPort),
      "-U",
      "seenit",
      "-d",
      "postgres",
      "-c",
      "create database seenit",
    ]);
    const dbUrl = `postgres://seenit@127.0.0.1:${pgPort}/seenit`;
    const psql = async (sql: string) =>
      (
        await exec("psql", [
          "-h",
          "127.0.0.1",
          "-p",
          String(pgPort),
          "-U",
          "seenit",
          "-d",
          "seenit",
          "-tAc",
          sql,
        ])
      ).stdout.trim();
    log("postgres 16 up");

    // --- Storage, Passport, webhooks ----------------------------------------------------------
    const s3Creds = {
      accessKeyId: "e2e-access",
      secretAccessKey: randomBytes(20).toString("hex"),
      bucket: "seenit-e2e",
    };
    const s3 = await startS3Emulator(s3Creds);
    cleanups.push(() => s3.close());

    const passport = createServer((req, res) => {
      const address = req.url?.split("/").at(-1);
      if (req.headers["x-api-key"] !== "hp-e2e-key") return void res.writeHead(401).end();
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          address,
          score: "27.5",
          passing_score: true,
          threshold: "20.00000",
          last_score_timestamp: new Date().toISOString(),
          expiration_timestamp: new Date(Date.now() + 90 * 86_400_000).toISOString(),
          error: null,
          stamps: {},
        }),
      );
    });
    servers.push(passport);
    const passportUrl = await listen(passport);

    const webhooks: Stack["webhooks"] = { url: "", received: [] };
    const hook = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      webhooks.received.push({
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(204).end();
    });
    servers.push(hook);
    webhooks.url = `${await listen(hook)}/seenit-webhook`;

    // --- API (production build of apps/web) -------------------------------------------------
    const apiPort = 13200;
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const cronSecret = randomBytes(24).toString("hex");
    const env: Record<string, string> = {
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      DATABASE_URL: dbUrl,
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: rpcUrl,
      MISSION_ESCROW_ADDRESS: deployment.missionEscrow,
      PERSONHOOD_REGISTRY_ADDRESS: deployment.personhoodRegistry,
      REWARD_TOKEN_ADDRESS: token,
      OPERATOR_PRIVATE_KEY: keys.operator,
      ATTESTER_PRIVATE_KEY: keys.attester,
      TIER1_MAX_REWARD: "5000000",
      INDEXER_START_BLOCK: String(deployment.blockNumber),
      R2_ACCOUNT_ID: "local",
      R2_ACCESS_KEY_ID: s3Creds.accessKeyId,
      R2_SECRET_ACCESS_KEY: s3Creds.secretAccessKey,
      R2_BUCKET: s3Creds.bucket,
      R2_ENDPOINT: s3.url,
      SIWE_DOMAIN: `127.0.0.1:${apiPort}`,
      CRON_SECRET: cronSecret,
      HUMAN_PASSPORT_API_URL: passportUrl,
      HUMAN_PASSPORT_API_KEY: "hp-e2e-key",
      HUMAN_PASSPORT_SCORER_ID: "42",
      HUMAN_PASSPORT_MIN_SCORE: "20",
      MEDIA_ENCRYPTION_KEYS: `e2e:${randomBytes(32).toString("base64")}`,
      WEBHOOK_ALLOW_HTTP: "true",
      REWARD_TOKEN_SYMBOL: "USDG",
      REWARD_TOKEN_DECIMALS: "6",
      ORIGINAL_RETENTION_DAYS: "30",
    };

    // Migrations, with the same helper the app uses.
    Object.assign(process.env, env);
    const db = await import("../../db/src/index.js");
    const conn = db.createDb(dbUrl);
    await db.migrateDb(conn);
    await (conn as unknown as { $client: { end(): Promise<void> } }).$client.end();
    log("database migrated");

    const webDir = join(ROOT, "apps/web");
    if (opts.build) {
      log("building apps/web (next build)…");
      await exec("pnpm", ["-F", "@seenit/web", "build"], {
        cwd: ROOT,
        env: { ...process.env, NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID) },
        maxBuffer: 64 * 1024 * 1024,
      });
    }
    const next = spawn(
      join(webDir, "node_modules/.bin/next"),
      ["start", "--port", String(apiPort), "--hostname", "127.0.0.1"],
      {
        cwd: webDir,
        env: { ...process.env, ...env },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let nextErr = "";
    next.stderr?.on("data", (d) => (nextErr = (nextErr + String(d)).slice(-4000)));
    procs.push(next);
    await waitFor("API", async () => (await fetch(`${apiUrl}/api/meta`)).ok, 90_000).catch((e) => {
      throw new Error(`${(e as Error).message}\n${nextErr}`);
    });
    log(`API up at ${apiUrl} (next start, production build)`);

    return {
      rpcUrl,
      apiUrl,
      dbUrl,
      s3,
      contracts: {
        token,
        registry: deployment.personhoodRegistry,
        escrow: deployment.missionEscrow,
        deployBlock: deployment.blockNumber,
      },
      keys,
      webhooks,
      env,
      cronSecret,
      log,
      psql,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
