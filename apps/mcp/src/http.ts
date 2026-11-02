import { timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";

const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

export interface HttpOptions {
  host: string;
  port: number;
  /** Bearer token required on /mcp. Mandatory when not bound to localhost. */
  token?: string;
  /** Hostnames allowed in Host/Origin when not on localhost (DNS-rebinding protection). */
  allowedHosts?: string[];
}

/**
 * Streamable HTTP endpoint at /mcp (stateless: a fresh McpServer per request), plus /health.
 * Host and Origin headers are checked to block DNS rebinding.
 */
export function createMcpHttpServer(
  factory: () => McpServer,
  opts: HttpOptions,
): { server: Server; close: () => Promise<void> } {
  const local = LOCAL.has(opts.host);
  if (!local && !opts.token)
    throw new Error("MCP_HTTP_TOKEN is required when the HTTP server is not bound to localhost");
  if (!local && !opts.allowedHosts?.length) {
    throw new Error(
      "MCP_HTTP_ALLOWED_HOSTS is required when the HTTP server is not bound to localhost",
    );
  }

  const handler = createMcpHandler(factory);
  const node = toNodeHandler(handler);
  const checkHost = local ? localhostHostValidation() : hostHeaderValidation(opts.allowedHosts!);
  const checkOrigin = local ? localhostOriginValidation() : originValidation(opts.allowedHosts!);

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (!checkHost(req, res) || !checkOrigin(req, res)) return;
    if (opts.token && !bearerMatches(req.headers.authorization, opts.token)) {
      res.writeHead(401, { "www-authenticate": "Bearer" }).end();
      return;
    }
    void node(req, res);
  });

  return {
    server,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
