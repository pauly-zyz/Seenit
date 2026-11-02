#!/usr/bin/env node
/**
 * Seenit MCP server.
 *   seenit-mcp            stdio (Claude Desktop / Claude Code launch it as a subprocess)
 *   seenit-mcp --http     Streamable HTTP on MCP_HTTP_HOST:MCP_HTTP_PORT at /mcp
 * stdout carries the stdio protocol: log only to stderr.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Seenit, type Hex } from "seenit-sdk";

import { parseEnv } from "./config.js";
import { ViemFunder } from "./funder.js";
import { createMcpHttpServer } from "./http.js";
import { createServer, type ServerDeps } from "./server.js";

async function main() {
  const env = parseEnv();
  const seenit = new Seenit({ apiKey: env.SEENIT_API_KEY, baseUrl: env.SEENIT_API_URL });
  const funder = env.SEENIT_FUNDER_PRIVATE_KEY
    ? await ViemFunder.create(seenit, env.SEENIT_FUNDER_PRIVATE_KEY as Hex, env.SEENIT_RPC_URL)
    : null;
  const deps: ServerDeps = { seenit, funder, maxSpend: env.SEENIT_MAX_SPEND };
  const factory = () => createServer(deps);
  const mode = funder
    ? `funding wallet ${funder.address}`
    : "user signs transactions in their own wallet";

  if (process.argv.includes("--http")) {
    const { server, close } = createMcpHttpServer(factory, {
      host: env.MCP_HTTP_HOST,
      port: env.MCP_HTTP_PORT,
      token: env.MCP_HTTP_TOKEN,
      allowedHosts: env.MCP_HTTP_ALLOWED_HOSTS?.split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    });
    server.listen(env.MCP_HTTP_PORT, env.MCP_HTTP_HOST, () =>
      console.error(
        `Seenit MCP server on http://${env.MCP_HTTP_HOST}:${env.MCP_HTTP_PORT}/mcp (${mode})`,
      ),
    );
    for (const sig of ["SIGINT", "SIGTERM"] as const)
      process.on(sig, () => void close().then(() => process.exit(0)));
    return;
  }

  void serveStdio(factory);
  console.error(`Seenit MCP server running on stdio (${mode})`);
}

main().catch((error: unknown) => {
  console.error(
    "Fatal error in Seenit MCP server:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
