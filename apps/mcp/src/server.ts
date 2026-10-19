import { McpServer } from "@modelcontextprotocol/server";

export const SERVER_NAME = "seenit";
export const SERVER_VERSION = "0.0.0";

/** Builds the Seenit MCP server. Tools are registered here as features land. */
export function createServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
}
