import { createServer as createNodeServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Seenit } from "seenit-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpHttpServer } from "../src/http.js";
import { createServer } from "../src/server.js";
import { fakeSeenitApi } from "./fake-api.js";

const TOKEN = "test-token-that-is-long-enough-123";
const api = fakeSeenitApi();
let apiServer: Server;
let apiUrl: string;

/** Serves the fake API over real HTTP so the stdio subprocess can reach it. */
beforeAll(async () => {
  apiServer = createNodeServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
    const r = await api.fetch(`http://x${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body,
    });
    res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
  });
  await new Promise<void>((r) => apiServer.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => apiServer.close(() => r())));

function raw(port: number, path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
}

describe("Streamable HTTP transport", () => {
  it("serves tools at /mcp behind a bearer token and Host/Origin checks", async () => {
    const seenit = new Seenit({ apiKey: "sk_test", baseUrl: apiUrl });
    const { server, close } = createMcpHttpServer(() => createServer({ seenit, funder: null }), {
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      expect(await raw(port, "/health")).toBe(200);
      expect(await raw(port, "/nope")).toBe(404);
      expect(await raw(port, "/mcp", { "content-type": "application/json" }, "POST")).toBe(401);
      // DNS rebinding: a foreign Host or Origin is refused even with the token.
      expect(
        await raw(port, "/mcp", { host: "evil.example", authorization: `Bearer ${TOKEN}` }, "POST"),
      ).toBe(403);
      expect(
        await raw(
          port,
          "/mcp",
          { origin: "https://evil.example", authorization: `Bearer ${TOKEN}` },
          "POST",
        ),
      ).toBe(403);

      const client = new Client(
        { name: "http-test", version: "1.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
        }),
      );
      const r = await client.callTool({ name: "list_templates", arguments: {} });
      expect(JSON.stringify(r.content)).toContain("store_open");
      await client.close();
    } finally {
      await close();
    }
  });

  it("refuses to listen beyond localhost without a token and allowed hosts", () => {
    const factory = () =>
      createServer({ seenit: new Seenit({ apiKey: "k", baseUrl: apiUrl }), funder: null });
    expect(() => createMcpHttpServer(factory, { host: "0.0.0.0", port: 1 })).toThrow(
      /MCP_HTTP_TOKEN/,
    );
    expect(() => createMcpHttpServer(factory, { host: "0.0.0.0", port: 1, token: TOKEN })).toThrow(
      /ALLOWED_HOSTS/,
    );
  });
});

describe("stdio transport", () => {
  it("runs as a subprocess the way Claude Desktop / Claude Code launch it", async () => {
    const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env: { ...getDefaultEnvironment(), SEENIT_API_URL: apiUrl, SEENIT_API_KEY: "sk_test" },
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("create_mission");
    const r = await client.callTool({
      name: "create_mission",
      arguments: {
        title: "Shelf check",
        instructions: "Photograph the drinks shelf, labels readable.",
        media_type: "photo",
        lat: 1,
        lng: 2,
        radius_m: 50,
        reward_per_capture: "1",
        max_captures: 2,
        deadline: "2026-11-03T10:00:00Z",
        template: "store_open",
      },
    });
    expect(JSON.stringify(r.content)).toContain("Draft saved");
    await client.close();
  }, 30_000);
});
