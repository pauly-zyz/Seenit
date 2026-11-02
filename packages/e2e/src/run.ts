/**
 * Seenit MVP end-to-end rehearsal.
 *
 *   pnpm -F @seenit/e2e e2e            (builds apps/web first)
 *   pnpm -F @seenit/e2e e2e --no-build
 *
 * Needs: Foundry (anvil, forge), PostgreSQL 16 binaries, ffmpeg. Writes docs/e2e-report.md.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { missionEscrowAbi, personhoodRegistryAbi, sha256ToBytes32 } from "@seenit/shared";
import { Seenit, SeenitError, verifyWebhookSignature } from "seenit-sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { ApiError, createApi, type SeenitApi } from "../../../apps/mobile/src/lib/api";
import { evaluateCaptureGate } from "../../../apps/mobile/src/lib/capture-gate";
import { buildSiweMessage } from "../../../apps/mobile/src/lib/siwe";
import { UploadQueue, type QueueItem } from "../../../apps/mobile/src/lib/upload-queue";
import { account, CHAIN_ID, localChain, ROLES, ROOT, startStack, type Stack } from "./stack";

type Step = { phase: string; name: string; ok: boolean; detail: string };
const steps: Step[] = [];
const txs: { what: string; hash: string }[] = [];
const started = new Date();

function record(phase: string, name: string, ok: boolean, detail: string) {
  steps.push({ phase, name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} [${phase}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(phase: string, name: string, fn: () => Promise<string | void>) {
  try {
    record(phase, name, true, (await fn()) ?? "");
  } catch (err) {
    record(phase, name, false, err instanceof Error ? err.message : String(err));
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Runs fn and returns the contract's custom error name, or throws if it didn't revert. */
async function revertName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof BaseError) {
      const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (r instanceof ContractFunctionRevertedError)
        return r.data?.errorName ?? r.reason ?? "reverted";
    }
    return (err as Error).message.slice(0, 80);
  }
  throw new Error("expected a revert, the call succeeded");
}

const MONAS = { lat: -6.175392, lng: 106.827153 };
const offset = (meters: number) => ({ lat: MONAS.lat + meters / 111_320, lng: MONAS.lng });

// -------------------------------------------------------------------------------------------------
// The contributor app (same API client, SIWE builder, capture gate and upload queue as apps/mobile)
// -------------------------------------------------------------------------------------------------

class Contributor {
  token: string | null = null;
  readonly api: SeenitApi;
  readonly account = privateKeyToAccount(generatePrivateKey());
  constructor(private readonly s: Stack) {
    this.api = createApi({ baseUrl: s.apiUrl, getToken: () => this.token, fetchFn: fetch });
  }
  get address() {
    return this.account.address;
  }

  async signIn() {
    const n = await this.api.getNonce();
    const message = buildSiweMessage({
      address: this.address,
      nonce: n.nonce,
      domain: n.domain,
      chainId: n.chainId,
      uri: this.s.apiUrl,
      issuedAt: new Date(),
    });
    const res = await this.api.verifySiwe(message, await this.account.signMessage({ message }));
    this.token = res.token;
    return res;
  }

  /** Takes a "photo" (a generated storefront JPEG) with the GPS fix at the shutter. */
  async capture(
    missionId: string,
    at: { lat: number; lng: number },
    opts: { mocked?: boolean; text?: string } = {},
  ) {
    const { storefrontJpeg } = await import("../../../apps/web/src/server/testing/media-fixtures");
    const bytes = await storefrontJpeg({
      text: opts.text ?? `LUNA BAKERY ${Math.random().toString(36).slice(2, 6)}`,
    });
    const dir = await mkdtemp(join(tmpdir(), "capture-"));
    const fileUri = join(dir, "photo.jpg");
    await writeFile(fileUri, bytes);
    const now = new Date();
    const capture = {
      missionId,
      source: "in_app_camera" as const,
      mediaType: "photo" as const,
      mediaSha256: createHash("sha256").update(bytes).digest("hex"),
      capturedAt: now.toISOString(),
      gps: {
        lat: at.lat,
        lng: at.lng,
        accuracyMeters: 6,
        fixAt: new Date(now.getTime() - 1000).toISOString(),
        isMocked: Boolean(opts.mocked),
      },
      device: {
        platform: "android" as const,
        appVersion: "0.1.0",
        model: "E2E Pixel",
        osVersion: "16",
      },
    };
    return { bytes, fileUri, capture };
  }

  /** The app's persistent upload queue, with fetch standing in for expo-file-system's upload task. */
  queue() {
    const items: QueueItem[] = [];
    const q = new UploadQueue({
      store: { load: async () => items, save: async () => undefined },
      api: this.api,
      uploadFile: async ({ fileUri, url, headers, onProgress }) => {
        const body = await readFile(fileUri);
        const res = await fetch(url, { method: "PUT", headers, body });
        onProgress(1);
        return { status: res.status };
      },
      deleteFile: () => undefined,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    return q;
  }
}

// -------------------------------------------------------------------------------------------------

async function main() {
  const build = !process.argv.includes("--no-build");
  const s = await startStack({ build, log: (m) => console.log(`· ${m}`) });
  const pub = createPublicClient({ chain: localChain(s.rpcUrl), transport: http(s.rpcUrl) });
  const balance = (who: Hex) =>
    pub.readContract({
      address: s.contracts.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [who],
    });
  const cron = () =>
    fetch(`${s.apiUrl}/api/cron/indexer`, {
      headers: { authorization: `Bearer ${s.cronSecret}` },
    }).then((r) => r.json());

  // The worker, in-process, with the real pipeline (ffmpeg/sharp, blur, encryption, webhooks).
  // Without ANTHROPIC_API_KEY the vision + face/plate detection calls are scripted.
  const worker = await buildWorker(s);
  const runWorker = async () => {
    const { runNextJob } = await import("../../../apps/web/src/server/worker");
    const ran: string[] = [];
    for (let r = await runNextJob(worker.ws); r; r = await runNextJob(worker.ws))
      ran.push(`${r.type}:${r.ok ? "ok" : r.error}`);
    return ran;
  };

  let mcp: Client | null = null;
  try {
    // ---------------------------------------------------------------------------------------------
    // 1. Deployment
    // ---------------------------------------------------------------------------------------------
    await check("deploy", "Contracts deployed with Deploy.s.sol and wired to the API", async () => {
      const meta = await (await fetch(`${s.apiUrl}/api/meta`)).json();
      assert(
        meta.chainId === CHAIN_ID && meta.escrow.toLowerCase() === s.contracts.escrow.toLowerCase(),
        "API meta doesn't match the deployment",
      );
      const opRole = await pub.readContract({
        address: s.contracts.escrow,
        abi: missionEscrowAbi,
        functionName: "OPERATOR_ROLE",
      });
      const ok = await pub.readContract({
        address: s.contracts.escrow,
        abi: missionEscrowAbi,
        functionName: "hasRole",
        args: [opRole, account(ROLES.operator).address],
      });
      assert(ok, "operator role missing");
      const fee = await pub.readContract({
        address: s.contracts.escrow,
        abi: missionEscrowAbi,
        functionName: "feeBps",
      });
      return `escrow ${s.contracts.escrow}, registry ${s.contracts.registry}, token ${s.contracts.token} (mock USDG), fee ${fee} bps`;
    });

    // ---------------------------------------------------------------------------------------------
    // 2. Funder: dashboard sign-in → API key → MCP agent creates and funds a mission
    // ---------------------------------------------------------------------------------------------
    const funder = account(ROLES.funder);
    let apiKey = "";
    await check(
      "funder",
      "Funder signs in to the dashboard (SIWE) and creates an API key",
      async () => {
        const n = await (await fetch(`${s.apiUrl}/api/auth/nonce`)).json();
        const message = createSiweMessage({
          address: funder.address,
          chainId: CHAIN_ID,
          domain: n.domain,
          nonce: n.nonce,
          uri: s.apiUrl,
          version: "1",
          issuedAt: new Date(),
        });
        const res = await fetch(`${s.apiUrl}/api/funder/auth/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, signature: await funder.signMessage({ message }) }),
        });
        assert(res.ok, `sign-in ${res.status}`);
        const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
        const noCsrf = await fetch(`${s.apiUrl}/api/funder/api-keys`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "e2e agent" }),
        });
        assert(noCsrf.status === 403, "cookie write without CSRF header must fail");
        const key = await fetch(`${s.apiUrl}/api/funder/api-keys`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json", "x-seenit-csrf": "1" },
          body: JSON.stringify({ name: "e2e agent" }),
        });
        apiKey = (await key.json()).key;
        assert(apiKey?.startsWith("sk_"), "no API key");
        return `funder ${funder.address}, key ${apiKey.slice(0, 10)}…`;
      },
    );

    const elicitations: string[] = [];
    mcp = new Client(
      { name: "e2e-agent", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    mcp.setRequestHandler("elicitation/create", async (req) => {
      elicitations.push((req.params as { message: string }).message);
      return { action: "accept", content: { approve: true } }; // the human says yes
    });
    await mcp.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", join(ROOT, "apps/mcp/src/index.ts")],
        cwd: join(ROOT, "apps/mcp"),
        env: {
          ...getDefaultEnvironment(),
          SEENIT_API_URL: s.apiUrl,
          SEENIT_API_KEY: apiKey,
          SEENIT_FUNDER_PRIVATE_KEY: s.keys.funder,
          SEENIT_RPC_URL: s.rpcUrl,
          SEENIT_MAX_SPEND: "50",
        },
        stderr: "pipe",
      }),
    );
    const tool = async (name: string, args: Record<string, unknown>) => {
      const r = await mcp!.callTool({ name, arguments: args });
      const text = (r.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");
      return {
        text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: r.structuredContent as Record<string, any>,
        isError: Boolean(r.isError),
      };
    };

    let missionId = "";
    const deadline = new Date(Date.now() + 6 * 3600_000).toISOString();
    await check("funder", "Agent creates a draft mission over MCP (stdio)", async () => {
      const r = await tool("create_mission", {
        title: "Is Luna Bakery near Monas open right now?",
        instructions:
          "Photograph the entrance from the street so the door and any posted notice are visible.",
        media_type: "photo",
        ...{ lat: MONAS.lat, lng: MONAS.lng },
        radius_m: 150,
        reward_per_capture: "2",
        max_captures: 3,
        deadline,
        template: "store_open",
      });
      assert(!r.isError, r.text);
      missionId = r.data.mission_id;
      assert(r.data.status === "pending_funding", "should be a draft");
      return `mission ${missionId}, ${r.data.total_escrow} to escrow, status pending_funding (nothing paid yet)`;
    });

    const funderBefore = await balance(funder.address);
    await check(
      "funder",
      "confirm_mission asks the human (elicitation), then funds the escrow on-chain",
      async () => {
        const r = await tool("confirm_mission", { mission_id: missionId });
        assert(!r.isError, r.text);
        assert(
          elicitations.length === 1 && elicitations[0]!.includes("6.00 USDG"),
          "no approval prompt shown",
        );
        const m = await new Seenit({ apiKey, baseUrl: s.apiUrl }).missions.status(missionId);
        assert(m.mission.status === "active", `mission is ${m.mission.status}`);
        txs.push({ what: "createMission (funder via MCP)", hash: m.mission.chainTxHash! });
        const escrowBal = await balance(s.contracts.escrow);
        assert(
          funderBefore - (await balance(funder.address)) === 6_000_000n,
          "funder wasn't debited 6 USDG",
        );
        return `prompt: “${elicitations[0]}” → escrow holds ${Number(escrowBal) / 1e6} USDG, on-chain mission #${m.mission.onchainId}`;
      },
    );

    // ---------------------------------------------------------------------------------------------
    // 3. Contributor: sign in, verify (Tier 1), find the mission, capture, upload
    // ---------------------------------------------------------------------------------------------
    const alice = new Contributor(s);
    await check("contributor", "Contributor signs in with SIWE (mobile client code)", async () => {
      const r = await alice.signIn();
      return `wallet ${alice.address}, tier ${r.user.tier}`;
    });

    await check(
      "fraud",
      "Unverified account can't take a mission (API refuses the upload URL)",
      async () => {
        const err = await alice.api
          .requestUploadUrl({
            missionId,
            mediaType: "photo",
            contentType: "image/jpeg",
            contentLength: 1000,
            gps: { ...offset(20), accuracyMeters: 6 },
          })
          .catch((e: ApiError) => e);
        assert(
          err instanceof ApiError && err.status === 403,
          `expected 403, got ${err instanceof ApiError ? err.status : "success"}`,
        );
        return `403 ${err.code}: ${err.message}`;
      },
    );

    await check(
      "contributor",
      "Tier 1 verification (Human Passport) is attested on-chain",
      async () => {
        const r = await alice.api.startVerification("human_passport");
        assert(r.status === "verified" && r.tier === 1, JSON.stringify(r));
        const ok = await pub.readContract({
          address: s.contracts.registry,
          abi: personhoodRegistryAbi,
          functionName: "isVerified",
          args: [alice.address, 1],
        });
        assert(ok, "registry says not verified");
        const tx = await s.psql(`select tx_hash from personhood_attestations limit 1`);
        txs.push({ what: "PersonhoodRegistry.attest (attester)", hash: tx });
        return `PersonhoodRegistry.isVerified(${alice.address.slice(0, 8)}…, 1) = true`;
      },
    );

    await check(
      "contributor",
      "Mission shows up nearby and the capture gate allows recording inside the radius",
      async () => {
        const near = await alice.api.getNearby({ ...offset(20), radiusKm: 5 });
        const m = near.missions.find((x) => x.id === missionId);
        assert(m && m.withinMissionRadius, "mission not listed as in range");
        const detail = await alice.api.getMission(missionId);
        assert(!detail.access.locked, "mission locked for tier 1");
        const now = Date.now();
        const inside = evaluateCaptureGate({
          permission: "granted",
          fix: { ...offset(20), accuracyMeters: 6, timestamp: now, mocked: false },
          mission: detail.mission,
          now,
        });
        const outside = evaluateCaptureGate({
          permission: "granted",
          fix: { ...offset(2000), accuracyMeters: 6, timestamp: now, mocked: false },
          mission: detail.mission,
          now,
        });
        const mocked = evaluateCaptureGate({
          permission: "granted",
          fix: { ...offset(20), accuracyMeters: 6, timestamp: now, mocked: true },
          mission: detail.mission,
          now,
        });
        assert(inside.canRecord && !outside.canRecord && !mocked.canRecord, "gate decisions wrong");
        return `${Math.round(m.distanceMeters)} m away; record button: inside=on, 2 km away=off (${outside.reason}), mock GPS=off (${mocked.reason})`;
      },
    );

    let submissionId = "";
    let original: Buffer = Buffer.alloc(0);
    await check(
      "contributor",
      "Photo is hashed on the device, uploaded to the signed URL and recorded on-chain",
      async () => {
        const shot = await alice.capture(missionId, offset(20), { text: "LUNA BAKERY" });
        original = shot.bytes;
        const q = alice.queue();
        await q.enqueue({
          id: "c1",
          missionId,
          missionTitle: "Luna",
          fileUri: shot.fileUri,
          contentType: "image/jpeg",
          size: shot.bytes.length,
          capture: shot.capture,
        });
        await q.drain();
        const item = q.getSnapshot()[0]!;
        assert(item.state === "done", `queue item ${item.state}: ${item.lastError}`);
        submissionId = item.submissionId!;
        const row = (
          await s.psql(
            `select status||'|'||record_tx_hash||'|'||media_hash from submissions where id='${submissionId}'`,
          )
        ).split("|");
        assert(row[0] === "processing", `status ${row[0]}`);
        assert(row[2] === shot.capture.mediaSha256, "stored hash differs");
        const onchain = await pub.readContract({
          address: s.contracts.escrow,
          abi: missionEscrowAbi,
          functionName: "getSubmission",
          args: [1n],
        });
        assert(
          (onchain as { mediaHash: Hex }).mediaHash === sha256ToBytes32(shot.capture.mediaSha256),
          "on-chain media hash differs",
        );
        txs.push({ what: "recordSubmission (operator)", hash: row[1]! });
        return `submission ${submissionId}; on-chain mediaHash = SHA-256 of the original (${shot.capture.mediaSha256.slice(0, 12)}…)`;
      },
    );

    // ---------------------------------------------------------------------------------------------
    // 4. Worker: blur → AI JSON → ready → webhook
    // ---------------------------------------------------------------------------------------------
    const sdk = new Seenit({ apiKey, baseUrl: s.apiUrl });
    let webhookSecret = "";
    await check("ai", "Funder registers a webhook", async () => {
      const w = await sdk.webhooks.set(s.webhooks.url);
      webhookSecret = w.secret;
      return w.url;
    });
    await check(
      "ai",
      "Worker blurs faces/plates, extracts the structured answer and marks it ready",
      async () => {
        const ran = await runWorker();
        const row = JSON.parse(
          await s.psql(
            `select json_build_object('status',status,'ai',ai_result,'blurred',blurred_frame_keys,'archive',original_archive_key) from submissions where id='${submissionId}'`,
          ),
        );
        assert(
          row.status === "ready",
          `status ${row.status}: ${JSON.stringify(row.ai?.reviewReasons)}`,
        );
        assert(row.ai.privacy.faces >= 1 && row.ai.privacy.checked, "no face was blurred");
        const blurred = s.s3.objects.get(row.blurred[0])!.bytes;
        assert(!blurred.equals(original), "funder copy is the original");
        assert(
          !s.s3.objects.has(`submissions/${missionId}`) &&
            ![...s.s3.objects.keys()].some((k) => k.endsWith("/original")),
          "plaintext original still stored",
        );
        assert(s.s3.objects.has(row.archive), "no encrypted dispute archive");
        return `jobs ${ran.join(", ")}; answer ${JSON.stringify(row.ai.answer)} (confidence ${row.ai.confidence}, model ${row.ai.model}); original only kept encrypted`;
      },
    );
    await check("ai", "Funder webhook delivered with a valid signature", async () => {
      await runWorker();
      const d = s.webhooks.received.at(-1);
      assert(d, "no webhook received");
      const ok = await verifyWebhookSignature({
        secret: webhookSecret,
        signatureHeader: d.headers["seenit-signature"],
        body: d.body,
      });
      assert(ok, "signature invalid");
      const body = JSON.parse(d.body);
      return `${body.event}: status ${body.data.status}, answer ${JSON.stringify(body.data.answer)}`;
    });
    await check(
      "ai",
      "get_results over MCP shows the pending answer with a blurred media link",
      async () => {
        const r = await tool("get_results", { mission_id: missionId, include_pending: true });
        const p = r.data.pending?.[0];
        assert(p?.answer?.is_open === "open", r.text);
        const media = await fetch(p.media[0]);
        assert(
          media.ok && media.headers.get("content-type") === "image/jpeg",
          "blurred media not downloadable",
        );
        return `pending ${p.submission_id}: ${JSON.stringify(p.answer)}, media link works (signed GET)`;
      },
    );

    // ---------------------------------------------------------------------------------------------
    // 5. Accept → payout on-chain
    // ---------------------------------------------------------------------------------------------
    await check(
      "payout",
      "Funder accepts; reward minus fee lands in the contributor's wallet",
      async () => {
        const before = await balance(alice.address);
        const treasuryBefore = await balance(account(ROLES.treasury).address);
        const r = await sdk.submissions.accept(submissionId);
        const payout = r.payout as { amount: string; fee: string; txHash: string };
        txs.push({ what: "acceptSubmission (operator, on funder's request)", hash: payout.txHash });
        const got = (await balance(alice.address)) - before;
        const fee = (await balance(account(ROLES.treasury).address)) - treasuryBefore;
        assert(got === 1_900_000n && fee === 100_000n, `paid ${got}, fee ${fee}`);
        return `contributor +${Number(got) / 1e6} USDG, treasury +${Number(fee) / 1e6} USDG (5% fee)`;
      },
    );
    await check(
      "payout",
      "Contributor's history and MCP results agree; indexer replays chain events idempotently",
      async () => {
        const h = await alice.api.getHistory();
        assert(h.summary.earned === "1900000", `earned ${h.summary.earned}`);
        const idx = await cron();
        const r = await tool("get_results", { mission_id: missionId });
        assert(
          r.data.results.length === 1 && r.data.results[0].proof.acceptTxHash,
          "accepted result missing",
        );
        const st = await sdk.missions.status(missionId);
        return `history earned ${Number(h.summary.earned) / 1e6} USDG; indexer ${JSON.stringify(idx)}; slots ${st.slots.used}/${st.slots.total}`;
      },
    );

    // ---------------------------------------------------------------------------------------------
    // 6. Fraud scenarios
    // ---------------------------------------------------------------------------------------------
    const bob = new Contributor(s);
    await bob.signIn();
    await bob.api.startVerification("human_passport");

    await check("fraud", "Upload from outside the radius is refused", async () => {
      const err = await bob.api
        .requestUploadUrl({
          missionId,
          mediaType: "photo",
          contentType: "image/jpeg",
          contentLength: 1000,
          gps: { ...offset(2000), accuracyMeters: 6 },
        })
        .catch((e: ApiError) => e);
      assert(err instanceof ApiError && err.status === 403, "not refused");
      return `403: ${err.message} (${JSON.stringify(err.details)})`;
    });
    await check("fraud", "Mock / spoofed GPS is refused", async () => {
      const err = await bob.api
        .requestUploadUrl({
          missionId,
          mediaType: "photo",
          contentType: "image/jpeg",
          contentLength: 1000,
          gps: { ...offset(20), accuracyMeters: 6, isMocked: true },
        })
        .catch((e: ApiError) => e);
      assert(err instanceof ApiError && err.status === 403, "not refused");
      return `403: ${err.message}`;
    });
    await check(
      "fraud",
      "Capture whose GPS (in signed metadata) is outside the area is refused at finalize",
      async () => {
        const shot = await bob.capture(missionId, offset(20));
        const up = await bob.api.requestUploadUrl({
          missionId,
          mediaType: "photo",
          contentType: "image/jpeg",
          contentLength: shot.bytes.length,
          gps: { ...offset(20), accuracyMeters: 6 },
        });
        await fetch(up.upload.url, { method: "PUT", headers: up.upload.headers, body: shot.bytes });
        const err = await bob.api
          .finalizeSubmission({
            submissionId: up.submissionId,
            capture: { ...shot.capture, gps: { ...shot.capture.gps, ...offset(1500) } },
          })
          .catch((e: ApiError) => e);
        assert(
          err instanceof ApiError && err.status === 422,
          `expected 422, got ${err instanceof ApiError ? err.status : "success"}`,
        );
        return `422 ${JSON.stringify(err.details)}`;
      },
    );
    await check(
      "fraud",
      "Hash mismatch (declared SHA-256 ≠ uploaded file) is refused and never reaches the chain",
      async () => {
        const carol = new Contributor(s);
        await carol.signIn();
        await carol.api.startVerification("human_passport");
        const shot = await carol.capture(missionId, offset(30));
        const up = await carol.api.requestUploadUrl({
          missionId,
          mediaType: "photo",
          contentType: "image/jpeg",
          contentLength: shot.bytes.length,
          gps: { ...offset(30), accuracyMeters: 6 },
        });
        const put = await fetch(up.upload.url, {
          method: "PUT",
          headers: up.upload.headers,
          body: shot.bytes,
        });
        assert(put.ok, `upload ${put.status}`);
        const fake = createHash("sha256").update("a different photo").digest("hex");
        const err = await carol.api
          .finalizeSubmission({
            submissionId: up.submissionId,
            capture: { ...shot.capture, mediaSha256: fake },
          })
          .catch((e: ApiError) => e);
        assert(err instanceof ApiError && err.status >= 400, "accepted a mismatched hash");
        const count = await pub
          .readContract({
            address: s.contracts.escrow,
            abi: missionEscrowAbi,
            functionName: "nextSubmissionId",
          })
          .catch(() => null);
        const status = await s.psql(`select status from submissions where id='${up.submissionId}'`);
        return `${err.status} ${err.code}: ${err.message}; DB status ${status}${count !== null ? `, on-chain submissions so far ${count}` : ""}`;
      },
    );
    await check(
      "fraud",
      "Upload that differs from the signed URL (content type / size) is refused by storage",
      async () => {
        const shot = await bob.capture(missionId, offset(20));
        const up = await bob.api.requestUploadUrl({
          missionId,
          mediaType: "photo",
          contentType: "image/jpeg",
          contentLength: shot.bytes.length,
          gps: { ...offset(20), accuracyMeters: 6 },
        });
        const html = await fetch(up.upload.url, {
          method: "PUT",
          headers: { ...up.upload.headers, "content-type": "text/html" },
          body: shot.bytes,
        });
        const bigger = await fetch(up.upload.url, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: new Uint8Array(Buffer.concat([shot.bytes, shot.bytes])),
        });
        assert(html.status === 403 && bigger.status === 403, `got ${html.status}/${bigger.status}`);
        return `403 / 403 (${s.s3.refused
          .slice(-2)
          .map((r) => r.reason)
          .join("; ")})`;
      },
    );
    await check("fraud", "Re-submitting the same media (replay) is refused", async () => {
      const dave = new Contributor(s);
      await dave.signIn();
      await dave.api.startVerification("human_passport");
      const up = await dave.api.requestUploadUrl({
        missionId,
        mediaType: "photo",
        contentType: "image/jpeg",
        contentLength: original.length,
        gps: { ...offset(20), accuracyMeters: 6 },
      });
      await fetch(up.upload.url, {
        method: "PUT",
        headers: up.upload.headers,
        body: new Uint8Array(original),
      });
      const shot = await dave.capture(missionId, offset(20));
      const err = await dave.api
        .finalizeSubmission({
          submissionId: up.submissionId,
          capture: {
            ...shot.capture,
            mediaSha256: createHash("sha256").update(original).digest("hex"),
          },
        })
        .catch((e: ApiError) => e);
      assert(
        err instanceof ApiError && err.status === 409,
        `expected 409, got ${err instanceof ApiError ? err.status : "success"}`,
      );
      return `409: ${err.message}`;
    });

    const operator = createWalletClient({
      account: privateKeyToAccount(s.keys.operator),
      chain: localChain(s.rpcUrl),
      transport: http(s.rpcUrl),
    });
    const attester = createWalletClient({
      account: privateKeyToAccount(s.keys.attester),
      chain: localChain(s.rpcUrl),
      transport: http(s.rpcUrl),
    });
    await check(
      "fraud",
      "Contract refuses to record a submission from an unverified wallet (even from the operator)",
      async () => {
        const stranger = privateKeyToAccount(generatePrivateKey()).address;
        const name = await revertName(() =>
          operator.writeContract({
            address: s.contracts.escrow,
            abi: missionEscrowAbi,
            functionName: "recordSubmission",
            args: [1n, stranger, keccak256(stringToBytes("x"))],
          }),
        );
        assert(name === "NotVerified", name);
        return `revert ${name}`;
      },
    );
    await check(
      "fraud",
      "Duplicate nullifier: one identity can't verify a second wallet",
      async () => {
        const nullifier = (await s.psql(
          `select nullifier_hash from personhood_attestations a join users u on u.id=a.user_id where u.wallet='${alice.address.toLowerCase()}'`,
        )) as Hex;
        const other = privateKeyToAccount(generatePrivateKey()).address;
        const name = await revertName(() =>
          attester.writeContract({
            address: s.contracts.registry,
            abi: personhoodRegistryAbi,
            functionName: "attest",
            args: [other, 1, nullifier, BigInt(Math.floor(Date.now() / 1000) + 86_400)],
          }),
        );
        assert(name === "NullifierBoundToOtherWallet", name);
        return `revert ${name} (nullifier ${nullifier.slice(0, 12)}… stays bound to ${alice.address.slice(0, 8)}…); API-level check covered by personhood tests`;
      },
    );
    await check("fraud", "Double accept is refused by the API and by the contract", async () => {
      const err = await sdk.submissions.accept(submissionId).catch((e: SeenitError) => e);
      assert(err instanceof SeenitError && err.status === 409, "second accept not refused");
      const name = await revertName(() =>
        operator.writeContract({
          address: s.contracts.escrow,
          abi: missionEscrowAbi,
          functionName: "acceptSubmission",
          args: [1n],
        }),
      );
      assert(name === "NotPending", name);
      assert((await balance(alice.address)) === 1_900_000n, "contributor paid twice");
      return `API 409 “${err.message}”; contract revert ${name}; contributor balance unchanged`;
    });
    await check(
      "fraud",
      "Another funder can't see or accept this mission's submissions",
      async () => {
        const other = account(ROLES.otherFunder);
        const n = await (await fetch(`${s.apiUrl}/api/auth/nonce`)).json();
        const message = createSiweMessage({
          address: other.address,
          chainId: CHAIN_ID,
          domain: n.domain,
          nonce: n.nonce,
          uri: s.apiUrl,
          version: "1",
          issuedAt: new Date(),
        });
        const res = await fetch(`${s.apiUrl}/api/funder/auth/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, signature: await other.signMessage({ message }) }),
        });
        const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
        const seen = await fetch(`${s.apiUrl}/api/missions/${missionId}/submissions`, {
          headers: { cookie },
        });
        const acc = await fetch(`${s.apiUrl}/api/submissions/${submissionId}/accept`, {
          method: "POST",
          headers: { cookie, "x-seenit-csrf": "1", "content-type": "application/json" },
          body: "{}",
        });
        assert(seen.status === 404 && acc.status === 404, `got ${seen.status}/${acc.status}`);
        return "404 / 404";
      },
    );
  } finally {
    await mcp?.close().catch(() => undefined);
    await writeReport(s);
    // Close the worker's DB pool before Postgres stops (otherwise pg reports a terminated connection).
    await (worker.ws.db as unknown as { $client?: { end(): Promise<void> } }).$client
      ?.end()
      .catch(() => undefined);
    await s.stop();
  }
  const failed = steps.filter((x) => !x.ok).length;
  console.log(`\n${steps.length - failed}/${steps.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

async function buildWorker(s: Stack) {
  Object.assign(process.env, s.env);
  const { parseEnv } = await import("../../../apps/web/src/server/config");
  const { buildServices } = await import("../../../apps/web/src/server/services/index");
  const { FfmpegMediaToolkit, DEFAULT_MEDIA_OPTIONS } =
    await import("../../../apps/web/src/server/processing/media");
  const { FetchWebhookSender } = await import("../../../apps/web/src/server/processing/webhooks");
  const { FACE_BOX } = await import("../../../apps/web/src/server/testing/media-fixtures");
  const env = parseEnv();
  const base = buildServices(env);
  const realAi = Boolean(process.env.ANTHROPIC_API_KEY);
  if (realAi) {
    // Exactly what `pnpm -F @seenit/web worker` builds, Claude included.
    const { createWorkerServicesFromEnv } =
      await import("../../../apps/web/src/server/processing/services");
    const { concurrency: _c, pollMs: _p, ...ws } = createWorkerServicesFromEnv();
    return { ws, realAi };
  }
  // Scripted stand-ins for the two Claude calls (no API key in this environment).
  const privacy = { detect: async () => [{ frame: 0, kind: "face" as const, box: FACE_BOX }] };
  const vision = {
    analyze: async () => ({
      kind: "answer" as const,
      answer: {
        is_open: "open",
        signage_text: "LUNA BAKERY",
        posted_hours: null,
        notice_text: null,
      },
      confidence: 0.93,
      reasoning: "Scripted: the door is open and an OPEN sign is visible.",
      quality: { relevant: true, blurry: false, too_dark: false, screen_capture: false, notes: "" },
      model: "scripted (no ANTHROPIC_API_KEY)",
    }),
  };
  const ws = {
    ...base,
    cipher: base.cipher!,
    media: new FfmpegMediaToolkit({
      ...DEFAULT_MEDIA_OPTIONS,
      blurThreshold: env.MEDIA_BLUR_THRESHOLD,
      darkThreshold: env.MEDIA_DARK_THRESHOLD,
    }),
    vision,
    privacy,
    webhooks: new FetchWebhookSender({ allowHttp: true }),
    processing: {
      reviewConfidence: env.AI_REVIEW_CONFIDENCE,
      retentionDays: env.ORIGINAL_RETENTION_DAYS,
      videoOverrunSeconds: 2,
    },
    tmpDir: tmpdir(),
  };
  return { ws, realAi };
}

async function writeReport(s: Stack) {
  const passed = steps.filter((x) => x.ok).length;
  const phases = ["deploy", "funder", "contributor", "ai", "payout", "fraud"];
  const titles: Record<string, string> = {
    deploy: "Deployment",
    funder: "Funder creates and funds a mission (dashboard + MCP)",
    contributor: "Verified contributor takes the mission (mobile app logic)",
    ai: "Processing: blur, AI answer, webhook",
    payout: "Accept and payout",
    fraud: "Fraud and abuse scenarios",
  };
  const lines = [
    "# Seenit MVP end-to-end report",
    "",
    `Generated by \`pnpm -F @seenit/e2e e2e\` on ${started.toISOString()}. **${passed}/${steps.length} checks passed.**`,
    "",
    "## Environment",
    "",
    `- Chain: local anvil with chain id ${CHAIN_ID} (same id as Robinhood Chain testnet), contracts deployed by \`script/Deploy.s.sol\`. Reward token: the test \`MockERC20\` (6 decimals) standing in for USDG.`,
    "- API: production build of `apps/web` (`next start`) on PostgreSQL 16, storage on a SigV4-verifying S3 emulator (stands in for R2).",
    "- Agent: the real MCP server (`apps/mcp`, stdio) driven by an MCP client that approves the funding prompt.",
    "- Contributor: the mobile app's own modules (`createApi`, `buildSiweMessage`, `evaluateCaptureGate`, `UploadQueue`); the camera is replaced by a generated photo.",
    `- Worker: the real pipeline (ffmpeg/sharp, blur, encryption, webhooks); the two Claude calls ${process.env.ANTHROPIC_API_KEY ? "used the real Claude API" : "were **scripted** (no ANTHROPIC_API_KEY in the run)"}.`,
    "- Human Passport: a local stand-in for the scorer API (score 27.5).",
    "",
  ];
  for (const p of phases) {
    const rows = steps.filter((x) => x.phase === p);
    if (!rows.length) continue;
    lines.push(`## ${titles[p]}`, "", "| | Check | Result |", "|---|---|---|");
    for (const r of rows)
      lines.push(
        `| ${r.ok ? "✅" : "❌"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
      );
    lines.push("");
  }
  if (txs.length) {
    lines.push("## On-chain transactions (local chain)", "", "| What | Tx hash |", "|---|---|");
    for (const t of txs) lines.push(`| ${t.what} | \`${t.hash}\` |`);
    lines.push("");
  }
  lines.push(
    "## Not covered by this run",
    "",
    "- A deployment to the real Robinhood Chain testnet (needs a funded deployer key and the official stablecoin address).",
    "- Real camera, GPS hardware and WalletConnect on a device; real Self passport NFC flow.",
    `- ${process.env.ANTHROPIC_API_KEY ? "" : "Real Claude vision and face/plate detection quality. "}Cloudflare R2 itself (the emulator checks the same SigV4 signatures).`,
    "",
  );
  await writeFile(join(ROOT, "docs/e2e-report.md"), lines.join("\n"));
  s.log(`report written to docs/e2e-report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
