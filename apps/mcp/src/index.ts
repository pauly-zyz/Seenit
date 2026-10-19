#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

// stdout carries the MCP protocol; log only to stderr.
async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("Seenit MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error in Seenit MCP server:", error);
  process.exit(1);
});
