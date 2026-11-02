import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Seenit } from "seenit-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerDeps } from "../src/server.js";
import { fakeFunder, fakeSeenitApi } from "./fake-api.js";

type Elicit = "accept" | "decline" | "none";

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

/** Connects a real MCP client to the server in-process (2026-07-28 era via handler.fetch). */
async function connect(opts: { funder?: boolean; maxSpend?: string; elicit?: Elicit } = {}) {
  const api = fakeSeenitApi();
  const funder = opts.funder ? fakeFunder(api) : null;
  const deps: ServerDeps = {
    seenit: new Seenit({ apiKey: "sk_test", baseUrl: "https://api.seenit.test", fetch: api.fetch }),
    funder,
    maxSpend: opts.maxSpend,
  };
  const handler = createMcpHandler(() => createServer(deps));
  const elicit = opts.elicit ?? "none";
  const prompts: string[] = [];
  const client = new Client(
    { name: "test", version: "1.0.0" },
    {
      capabilities: elicit === "none" ? {} : { elicitation: { form: {} } },
      versionNegotiation: { mode: "auto" },
    },
  );
  if (elicit !== "none") {
    client.setRequestHandler("elicitation/create", async (req) => {
      prompts.push((req.params as { message: string }).message);
      return elicit === "accept"
        ? { action: "accept", content: { approve: true } }
        : { action: "decline" };
    });
  }
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  open.push({ close: async () => (await client.close(), await handler.close()) });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    return { ...r, text, data: r.structuredContent as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { client, call, api, funder, prompts };
}

const draft = {
  title: "Is Luna Bakery open?",
  instructions: "Photograph the entrance and any posted notice.",
  media_type: "photo",
  lat: -6.175392,
  lng: 106.827153,
  radius_m: 100,
  reward_per_capture: "2",
  max_captures: 3,
  deadline: "2026-11-03T10:00:00+07:00",
  template: "store_open",
};

async function createDraft(c: Awaited<ReturnType<typeof connect>>) {
  const r = await c.call("create_mission", draft);
  return r.data.mission_id as string;
}

describe("tools", () => {
  it("lists the six tools with safety annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      [
        "cancel_mission",
        "confirm_mission",
        "create_mission",
        "get_mission_status",
        "get_results",
        "list_templates",
      ].sort(),
    );
    expect(byName.confirm_mission!.annotations).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false,
    });
    expect(byName.get_results!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.create_mission!.inputSchema.required).toEqual(
      expect.arrayContaining([
        "title",
        "instructions",
        "media_type",
        "lat",
        "lng",
        "radius_m",
        "reward_per_capture",
        "max_captures",
        "deadline",
      ]),
    );
    expect(client.getInstructions()).toMatch(/explicit approval/);
  });

  it("list_templates", async () => {
    const c = await connect();
    const r = await c.call("list_templates");
    expect(r.text).toContain("store_open");
    expect(r.data.templates[0].id).toBe("store_open");
  });
});

describe("create_mission", () => {
  it("saves a draft with the template schema and reward in base units, and returns a summary", async () => {
    const c = await connect();
    const r = await c.call("create_mission", { ...draft, reward_per_capture: "2.5" });
    expect(r.isError).toBeFalsy();
    const post = c.api.calls.find((x) => x.method === "POST" && x.path === "/api/missions")!;
    expect(post.apiKey).toBe("sk_test");
    expect(post.body).toMatchObject({
      rewardPerSubmission: "2500000",
      maxSubmissions: 3,
      radiusMeters: 100,
      location: { lat: -6.175392, lng: 106.827153 },
      outputSchema: { properties: { is_open: { type: "string" } } },
    });
    expect(r.text).toContain("Draft saved (not live, nothing paid yet)");
    expect(r.text).toContain("Total to escrow: 7.50 USDG");
    expect(r.text).toContain("ask the user to approve");
    expect(r.data).toMatchObject({
      status: "pending_funding",
      total_escrow: "7.50 USDG",
      total_escrow_base_units: "7500000",
    });
  });

  it("defaults video length and accepts a custom output schema", async () => {
    const c = await connect();
    const schema = { type: "object", properties: { queue: { type: "integer" } } };
    const { template: _t, ...rest } = draft;
    await c.call("create_mission", { ...rest, media_type: "video", output_schema: schema });
    expect(c.api.calls.at(-1)!.body).toMatchObject({
      mediaType: "video",
      maxVideoSeconds: 30,
      outputSchema: schema,
    });
  });

  it("rejects ambiguous or missing answer formats and surfaces API errors", async () => {
    const c = await connect();
    const { template: _t, ...noFormat } = draft;
    expect((await c.call("create_mission", noFormat)).isError).toBe(true);
    expect(
      (await c.call("create_mission", { ...draft, output_schema: { type: "object" } })).isError,
    ).toBe(true);
    const err = await c.call("create_mission", { ...draft, title: "boom" });
    expect(err.isError).toBe(true);
    expect(err.text).toContain("validation_failed");
    const bad = await c.call("create_mission", { ...draft, reward_per_capture: "-1" });
    expect(bad.isError).toBe(true);
  });
});

describe("confirm_mission", () => {
  it("without a funder wallet, returns the transactions for the user to sign, then activates from the tx hash", async () => {
    const c = await connect();
    const id = await createDraft(c);
    const r = await c.call("confirm_mission", { mission_id: id });
    expect(r.text).toContain("signs these two transactions");
    expect(r.data.transactions).toHaveLength(2);
    expect(c.api.missions.get(id)!.status).toBe("pending_funding");

    const live = await c.call("confirm_mission", {
      mission_id: id,
      tx_hash: `0x${"cd".repeat(32)}`,
    });
    expect(live.text).toContain("Mission is live");
    expect(c.api.missions.get(id)!.status).toBe("active");
  });

  it("asks the user through the client (elicitation) before funding, and funds on accept", async () => {
    const c = await connect({ funder: true, elicit: "accept" });
    const id = await createDraft(c);
    const r = await c.call("confirm_mission", { mission_id: id });
    expect(c.prompts).toHaveLength(1);
    expect(c.prompts[0]).toContain("6.00 USDG");
    expect(c.funder!.funded).toEqual([id]);
    expect(r.text).toContain("Funded 6.00 USDG");
  });

  it("does nothing when the user declines", async () => {
    const c = await connect({ funder: true, elicit: "decline" });
    const id = await createDraft(c);
    const r = await c.call("confirm_mission", { mission_id: id, user_confirmed: true });
    expect(r.text).toContain("did not approve");
    expect(c.funder!.funded).toEqual([]);
  });

  it("without elicitation, refuses until the agent passes the user's explicit confirmation", async () => {
    const c = await connect({ funder: true });
    const id = await createDraft(c);
    const first = await c.call("confirm_mission", { mission_id: id });
    expect(first.isError).toBe(true);
    expect(first.text).toContain("user_confirmed: true");
    expect(c.funder!.funded).toEqual([]);
    await c.call("confirm_mission", { mission_id: id, user_confirmed: true });
    expect(c.funder!.funded).toEqual([id]);
  });

  it("enforces the spending cap", async () => {
    const c = await connect({ funder: true, maxSpend: "5", elicit: "accept" });
    const id = await createDraft(c);
    const r = await c.call("confirm_mission", { mission_id: id });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("spending cap");
    expect(c.prompts).toHaveLength(0);
    expect(c.funder!.funded).toEqual([]);
  });

  it("reports live missions and unknown ids", async () => {
    const c = await connect({ funder: true, elicit: "accept" });
    const id = await createDraft(c);
    c.api.setStatus(id, "active");
    expect((await c.call("confirm_mission", { mission_id: id })).text).toContain("already live");
    const missing = await c.call("confirm_mission", {
      mission_id: "00000000-0000-4000-8000-000000000999",
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not_found");
  });
});

describe("status, results, cancel", () => {
  it("get_mission_status summarizes slots, submissions and escrow", async () => {
    const c = await connect();
    const id = await createDraft(c);
    const r = await c.call("get_mission_status", { mission_id: id });
    expect(r.text).toContain("Slots: 1/3 used, 2 left");
    expect(r.text).toContain("1 need review");
    expect(r.text).toContain("Not funded yet");
    expect(r.data.slots).toEqual({ total: 3, used: 1, left: 2 });
  });

  it("get_results returns structured answers with blurred media links, optionally pending ones", async () => {
    const c = await connect();
    const id = await createDraft(c);
    const r = await c.call("get_results", { mission_id: id, include_pending: true });
    expect(r.data.results[0]).toMatchObject({
      answer: { is_open: "open" },
      confidence: 0.94,
      media: ["https://r2.test/blurred/s1/frame-0.jpg?sig"],
    });
    expect(r.data.pending).toEqual([
      expect.objectContaining({
        submission_id: "s2",
        status: "needs_review",
        review_reasons: ["too_dark"],
      }),
    ]);
    expect(r.text).toContain("1 accepted result(s)");
  });

  it("cancels a draft at once", async () => {
    const c = await connect();
    const id = await createDraft(c);
    const r = await c.call("cancel_mission", { mission_id: id });
    expect(r.text).toContain("Nothing was funded");
    expect(c.api.missions.get(id)!.status).toBe("cancelled");
  });

  it("returns the cancel transaction for a live mission without a funder wallet", async () => {
    const c = await connect();
    const id = await createDraft(c);
    c.api.setStatus(id, "active");
    const r = await c.call("cancel_mission", { mission_id: id });
    expect(r.data.transactions).toHaveLength(1);
    const done = await c.call("cancel_mission", {
      mission_id: id,
      tx_hash: `0x${"ce".repeat(32)}`,
    });
    expect(done.text).toContain("Refunded 4.00 USDG");
  });

  it("asks before cancelling a live mission with the funder wallet", async () => {
    const c = await connect({ funder: true, elicit: "accept" });
    const id = await createDraft(c);
    c.api.setStatus(id, "active");
    const r = await c.call("cancel_mission", { mission_id: id });
    expect(c.prompts[0]).toContain("Cancel the live Seenit mission");
    expect(c.funder!.cancelled).toEqual([id]);
    expect(r.text).toContain("Refunded 4.00 USDG");
  });
});

describe("2025-era clients", () => {
  it("still get the elicitation prompt (the SDK's legacy shim) and fund only on accept", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/client");
    const api = fakeSeenitApi();
    const funder = fakeFunder(api);
    const seenit = new Seenit({
      apiKey: "sk_test",
      baseUrl: "https://api.seenit.test",
      fetch: api.fetch,
    });
    const server = createServer({ seenit, funder });
    const client = new Client(
      { name: "legacy", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    const prompts: string[] = [];
    client.setRequestHandler("elicitation/create", async (req) => {
      prompts.push((req.params as { message: string }).message);
      return { action: "accept", content: { approve: true } };
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    open.push({ close: async () => (await client.close(), await server.close()) });

    const created = await client.callTool({ name: "create_mission", arguments: draft });
    const id = (created.structuredContent as { mission_id: string }).mission_id;
    const r = await client.callTool({ name: "confirm_mission", arguments: { mission_id: id } });
    expect(prompts).toHaveLength(1);
    expect(funder.funded).toEqual([id]);
    expect(JSON.stringify(r.content)).toContain("Funded 6.00 USDG");
  });
});
