import {
  acceptedContent,
  inputRequired,
  inputResponse,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import {
  formatAmount,
  parseUnits,
  SeenitError,
  type Hex,
  type Meta,
  type Mission,
  type Seenit,
  type TxRequest,
} from "seenit-sdk";
import { z } from "zod";

import type { Funder } from "./funder.js";

export const SERVER_NAME = "seenit";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  seenit: Seenit;
  /** Signs funding/cancel transactions. Null: return them for the user's own wallet. */
  funder: Funder | null;
  /** Max escrow per mission the funder may sign, in token units (e.g. "50"). */
  maxSpend?: string;
}

const TEMPLATE_IDS = [
  "stock_check",
  "store_open",
  "construction_progress",
  "billboard_proof",
  "crowd_level",
] as const;

const missionId = z.uuid().describe("Mission id returned by create_mission");
const txHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .describe("Hash of the mined transaction, when the user signed it in their own wallet");
const userConfirmed = z
  .boolean()
  .optional()
  .describe(
    "Only for clients that can't show a confirmation prompt: set true ONLY after the user explicitly approved this exact action in the conversation.",
  );

const INSTRUCTIONS = `Seenit sends verified people to real places to take photos or videos for you, and turns each capture into a structured JSON answer. Rewards are paid in stablecoins from an on-chain escrow.

Flow: list_templates (optional) → create_mission (saves a draft, no money moves) → show the summary to the user and get their explicit approval of the total cost → confirm_mission (funds the escrow; the mission goes live) → get_mission_status / get_results. cancel_mission refunds unused slots.

Never call confirm_mission or cancel_mission without the user's explicit approval of that specific mission and amount.`;

/** Builds the Seenit MCP server. One instance per stdio connection or per HTTP request. */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const { seenit } = deps;

  const canElicit = () => Boolean(server.server.getClientCapabilities()?.elicitation);

  server.registerTool(
    "list_templates",
    {
      title: "List mission templates",
      description:
        "Ready-made answer formats (output schemas) for common missions: stock_check, store_open, construction_progress, billboard_proof, crowd_level. Pass the id as `template` to create_mission.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard(async () => {
        const templates = await seenit.templates.list();
        const text = templates
          .map(
            (t) =>
              `• ${t.id} (${t.mediaType}): ${t.description}\n  Suggested instructions: ${t.suggestedInstructions}`,
          )
          .join("\n");
        return ok(text, { templates });
      }),
  );

  server.registerTool(
    "create_mission",
    {
      title: "Create a mission (draft)",
      description:
        "Saves a mission as an unfunded draft and returns a summary with the total cost. Nothing is live and no money moves. Show the summary to the user and ask them to approve the total before calling confirm_mission.",
      inputSchema: z.object({
        title: z.string().min(3).max(120),
        instructions: z
          .string()
          .min(10)
          .max(4000)
          .describe(
            "What to capture, written for the person on site (what, from where, what must be visible).",
          ),
        media_type: z.enum(["photo", "video"]),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radius_m: z
          .number()
          .int()
          .min(10)
          .max(5000)
          .describe("Capture must happen within this many meters."),
        reward_per_capture: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .describe('Reward per accepted capture in token units, e.g. "2.5" (USDG).'),
        max_captures: z.number().int().min(1).max(1000),
        deadline: z.iso
          .datetime({ offset: true })
          .describe("ISO 8601 with timezone, 10 minutes to 90 days ahead."),
        template: z.enum(TEMPLATE_IDS).optional().describe("Use a ready-made answer format."),
        output_schema: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('JSON Schema (type "object") of the answer to extract, if no template fits.'),
        max_video_seconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe("Video missions only. Default 30."),
        min_tier: z
          .union([z.literal(1), z.literal(2)])
          .optional()
          .describe(
            "1 = Human Passport, 2 = passport NFC (Self). Raised to 2 automatically for high rewards.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (a) =>
      guard(async () => {
        if (!a.template && !a.output_schema)
          return fail("Give either `template` or `output_schema`.");
        if (a.template && a.output_schema)
          return fail("Give `template` or `output_schema`, not both.");
        const meta = await seenit.meta();
        const created = await seenit.missions.create({
          title: a.title,
          instructions: a.instructions,
          mediaType: a.media_type,
          maxVideoSeconds: a.media_type === "video" ? (a.max_video_seconds ?? 30) : undefined,
          location: { lat: a.lat, lng: a.lng },
          radiusMeters: a.radius_m,
          rewardPerSubmission: parseUnits(a.reward_per_capture, meta.token.decimals),
          maxSubmissions: a.max_captures,
          deadline: a.deadline,
          minTier: a.min_tier,
          template: a.template,
          outputSchema: a.output_schema,
        });
        const m = created.mission;
        const total = formatAmount(created.funding.total, meta.token.decimals, meta.token.symbol);
        const funding = deps.funder
          ? `confirm_mission will fund it from wallet ${deps.funder.address}.`
          : "confirm_mission will return two transactions (approve, createMission) for the user to sign in their wallet.";
        const text = [
          `Draft saved (not live, nothing paid yet). Mission id: ${m.id}`,
          summary(m, meta),
          `Total to escrow: ${total} (${m.maxCaptures} × ${amount(m.reward, meta)}). A platform fee is taken from each paid reward; unused slots are refunded.`,
          `Next: ask the user to approve funding ${total} for this mission. Only after they say yes, call confirm_mission. ${funding}`,
        ].join("\n\n");
        return ok(text, {
          mission_id: m.id,
          status: m.status,
          total_escrow: formatAmount(created.funding.total, meta.token.decimals, meta.token.symbol),
          total_escrow_base_units: created.funding.total,
          mission: m,
          next_step: "confirm_mission after explicit user approval",
        });
      }),
  );

  server.registerTool(
    "confirm_mission",
    {
      title: "Fund and publish a mission",
      description:
        "Funds the escrow for a draft mission so it goes live. Spends the user's stablecoins: call only after the user explicitly approved this mission and its total. The client may also ask the user to confirm.",
      inputSchema: z.object({
        mission_id: missionId,
        tx_hash: txHash.optional(),
        user_confirmed: userConfirmed,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (a, ctx) =>
      guard(async () => {
        const [status, meta] = await Promise.all([
          seenit.missions.status(a.mission_id),
          seenit.meta(),
        ]);
        const m = status.mission;
        if (m.status === "active")
          return ok(`Mission ${m.id} is already live.\n\n${summary(m, meta)}`, { mission: m });
        if (m.status !== "pending_funding" || !status.funding)
          return fail(`Mission is ${m.status} and can't be funded.`);
        const total = formatAmount(status.funding.total, meta.token.decimals, meta.token.symbol);

        // The user signs in their own wallet: activate from their mined tx, or hand them the txs.
        if (a.tx_hash) {
          const live = await seenit.missions.confirm(m.id, a.tx_hash as Hex);
          return ok(`Mission is live.\n\n${summary(live, meta)}`, { mission: live });
        }
        if (!deps.funder) {
          return ok(
            [
              `To publish "${m.title}", the user signs these two transactions on chain ${meta.chainId} (${total} goes into escrow), in order:`,
              txList(status.funding.transactions),
              "Then call confirm_mission again with tx_hash = the createMission transaction hash.",
            ].join("\n\n"),
            {
              mission_id: m.id,
              chain_id: meta.chainId,
              transactions: status.funding.transactions,
              total,
            },
          );
        }

        const cap = deps.maxSpend ? parseUnits(deps.maxSpend, meta.token.decimals) : null;
        if (cap !== null && BigInt(status.funding.total) > cap) {
          return fail(
            `Total ${total} is above this server's spending cap (${deps.maxSpend} ${meta.token.symbol}).`,
          );
        }
        const approval = approve({
          ctx,
          canElicit: canElicit(),
          key: `fund:${m.id}`,
          message: `Fund the Seenit mission "${m.title}" with ${total} from wallet ${deps.funder.address}? It goes live right away; unused slots are refunded.`,
          userConfirmed: a.user_confirmed,
        });
        if (approval !== "approved") return approval;

        const out = await deps.funder.fund(m.id, cap);
        return ok(
          `Funded ${total}. Mission is live.\n\n${summary(out.mission, meta)}${out.txHash ? `\nTransaction: ${out.txHash}` : ""}`,
          {
            mission: out.mission,
            tx_hash: out.txHash,
          },
        );
      }),
  );

  server.registerTool(
    "get_mission_status",
    {
      title: "Mission status",
      description: "Status, slots left, submissions waiting for review, payouts so far.",
      inputSchema: z.object({ mission_id: missionId }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        const [s, meta] = await Promise.all([seenit.missions.status(a.mission_id), seenit.meta()]);
        const sub = s.submissions;
        const text = [
          summary(s.mission, meta),
          `Slots: ${s.slots.used}/${s.slots.total} used, ${s.slots.left} left`,
          `Submissions: ${sub.processing} processing, ${sub.ready} ready, ${sub.needsReview} need review, ${sub.accepted} accepted, ${sub.rejected} rejected`,
          `Escrow: ${amount(s.escrow.total, meta)} total, ${amount(s.escrow.paidToContributors, meta)} paid to contributors`,
          s.funding ? "Not funded yet: call confirm_mission after the user approves." : "",
        ]
          .filter(Boolean)
          .join("\n");
        return ok(text, s as unknown as Record<string, unknown>);
      }),
  );

  server.registerTool(
    "get_results",
    {
      title: "Get mission results",
      description:
        "Structured JSON answers from accepted captures, with short-lived links to the privacy-blurred photos/frames and on-chain proof. Set include_pending to also see AI answers still waiting for review.",
      inputSchema: z.object({
        mission_id: missionId,
        include_pending: z
          .boolean()
          .optional()
          .describe("Also return answers not accepted yet (ready / needs_review)."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        const res = await seenit.missions.results(a.mission_id);
        const results = res.results.map((r) => ({
          submission_id: r.submissionId,
          captured_at: r.capturedAt,
          answer: r.answer,
          confidence: r.confidence,
          reasoning: r.reasoning,
          media: r.media?.frames.map((f) => f.url) ?? [],
          media_expires_at: r.media?.expiresAt ?? null,
          proof: r.proof,
        }));
        let pending: unknown[] | undefined;
        if (a.include_pending) {
          const q = await seenit.missions.submissions(a.mission_id);
          pending = q.submissions
            .filter(
              (s) =>
                s.status === "ready" || s.status === "needs_review" || s.status === "processing",
            )
            .map((s) => ({
              submission_id: s.submissionId,
              status: s.status,
              answer: s.ai?.answer ?? null,
              confidence: s.ai?.confidence ?? null,
              review_reasons: s.ai?.reviewReasons ?? [],
              review_deadline: s.reviewDeadline,
              media: s.media?.frames.map((f) => f.url) ?? [],
            }));
        }
        const head = `${res.results.length} accepted result(s) for "${res.mission.title}" (${res.mission.status}).`;
        const body = { mission: res.mission, results, ...(pending ? { pending } : {}) };
        return ok(
          `${head} Media links expire in about 15 minutes.\n\n${JSON.stringify(body, null, 2)}`,
          body,
        );
      }),
  );

  server.registerTool(
    "cancel_mission",
    {
      title: "Cancel a mission",
      description:
        "Cancels a mission. A draft closes at once. A live mission is cancelled on-chain and unused slots are refunded to the funder; submissions already recorded can still be reviewed. Call only after the user explicitly asked to cancel this mission.",
      inputSchema: z.object({
        mission_id: missionId,
        tx_hash: txHash.optional(),
        user_confirmed: userConfirmed,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (a, ctx) =>
      guard(async () => {
        const [status, meta] = await Promise.all([
          seenit.missions.status(a.mission_id),
          seenit.meta(),
        ]);
        const m = status.mission;
        if (m.status === "cancelled" || m.status === "refunded")
          return ok(`Mission is already ${m.status}.`, { mission: m });

        if (a.tx_hash) {
          const done = await seenit.missions.cancel(m.id, { txHash: a.tx_hash as Hex });
          return ok(cancelText(done.mission, done.refunded, meta), {
            mission: done.mission,
            refunded: done.refunded ?? null,
          });
        }
        if (m.status === "pending_funding") {
          const done = await seenit.missions.cancel(m.id);
          return ok(`Draft "${m.title}" cancelled. Nothing was funded.`, { mission: done.mission });
        }
        if (!deps.funder) {
          const res = await seenit.missions.cancel(m.id);
          return ok(
            [
              `To cancel "${m.title}", the user signs this transaction on chain ${meta.chainId} from the funding wallet:`,
              txList(res.transactions),
              "Then call cancel_mission again with tx_hash.",
            ].join("\n\n"),
            { mission_id: m.id, chain_id: meta.chainId, transactions: res.transactions },
          );
        }
        const approval = approve({
          ctx,
          canElicit: canElicit(),
          key: `cancel:${m.id}`,
          message: `Cancel the live Seenit mission "${m.title}"? Unused slots are refunded to ${deps.funder.address}.`,
          userConfirmed: a.user_confirmed,
        });
        if (approval !== "approved") return approval;
        const out = await deps.funder.cancel(m.id);
        return ok(cancelText(out.mission, out.refunded, meta), {
          mission: out.mission,
          tx_hash: out.txHash,
          refunded: out.refunded ?? null,
        });
      }),
  );

  return server;
}

// ------------------------------------------------------------------------------------------------
// Approval gate
// ------------------------------------------------------------------------------------------------

const approvalSchema = z.object({
  approve: z.boolean().describe("Yes, go ahead"),
});

type ToolCtx = { mcpReq: { inputResponses?: Record<string, unknown> } };

/**
 * Asks the user directly when the client supports elicitation (the model can't answer for them).
 * Otherwise requires `user_confirmed: true`, which the tool description reserves for an explicit
 * approval in the conversation.
 */
function approve(o: {
  ctx: ToolCtx;
  canElicit: boolean;
  key: string;
  message: string;
  userConfirmed?: boolean;
}): "approved" | CallToolResult | ReturnType<typeof inputRequired> {
  const responses = o.ctx.mcpReq.inputResponses;
  const answer = acceptedContent(responses, o.key, approvalSchema);
  if (answer?.approve === true) return "approved";
  const view = inputResponse(responses, o.key);
  if (answer?.approve === false || (view.kind === "elicit" && view.action !== "accept")) {
    return { content: [{ type: "text", text: "The user did not approve. Nothing was done." }] };
  }
  if (o.canElicit) {
    return inputRequired({
      inputRequests: {
        [o.key]: inputRequired.elicit({ message: o.message, requestedSchema: approvalSchema }),
      },
    });
  }
  if (o.userConfirmed === true) return "approved";
  return fail(
    `This needs the user's explicit approval. Ask them: "${o.message}" If they say yes, call this tool again with user_confirmed: true.`,
  );
}

// ------------------------------------------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------------------------------------------

const amount = (v: string, meta: Meta) => formatAmount(v, meta.token.decimals, meta.token.symbol);

function summary(m: Mission, meta: Meta): string {
  const props = Object.keys(
    (m.outputSchema?.properties as Record<string, unknown> | undefined) ?? {},
  );
  return [
    `"${m.title}" — ${m.status}`,
    `Where: ${m.location.lat.toFixed(5)}, ${m.location.lng.toFixed(5)} (within ${m.radiusMeters} m)`,
    `Capture: ${m.mediaType}${m.mediaType === "video" && m.maxVideoSeconds ? `, up to ${m.maxVideoSeconds} s` : ""}`,
    `Reward: ${amount(m.reward, meta)} per accepted capture, up to ${m.maxCaptures} captures`,
    `Contributors: Tier ${m.minTier} verified humans`,
    `Deadline: ${m.deadline}`,
    `Answer fields: ${props.join(", ") || "(see output schema)"}`,
  ].join("\n");
}

function txList(txs: TxRequest[]) {
  return txs
    .map((t, i) => `${i + 1}. ${t.description}\n   to: ${t.to}\n   data: ${t.data}\n   value: 0`)
    .join("\n");
}

function cancelText(m: Mission, refunded: string | undefined, meta: Meta) {
  return `Mission "${m.title}" is ${m.status}.${refunded ? ` Refunded ${amount(refunded, meta)} to the funder.` : ""}`;
}

function ok(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: jsonSafe(structured) };
}

function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** API errors become tool errors the model can read and act on. */
async function guard<T>(fn: () => Promise<T>): Promise<T | CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SeenitError) {
      const details = err.details ? `\nDetails: ${JSON.stringify(err.details)}` : "";
      return fail(`Seenit API error (${err.code}): ${err.message}${details}`);
    }
    return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function jsonSafe(v: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
