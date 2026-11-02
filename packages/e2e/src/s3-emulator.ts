import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SignatureV4 } from "@smithy/signature-v4";

/**
 * Minimal S3-compatible server (path-style) for local rehearsals of Cloudflare R2.
 * Every request must carry a valid AWS SigV4 signature for the configured credentials, either
 * presigned (query string, as the phone uses) or in the Authorization header (as the API uses).
 * Expired presigned URLs and changed signed headers (content-type, content-length) are refused,
 * which is what the signed-URL permissions rely on.
 */
export interface S3Emulator {
  url: string;
  objects: Map<string, { bytes: Buffer; contentType: string }>;
  /** Requests refused, with the reason (for the report). */
  refused: { method: string; path: string; reason: string }[];
  close(): Promise<void>;
}

const toBuf = (d: string | ArrayBuffer | ArrayBufferView) =>
  typeof d === "string"
    ? Buffer.from(d)
    : ArrayBuffer.isView(d)
      ? Buffer.from(d.buffer, d.byteOffset, d.byteLength)
      : Buffer.from(d);

class Sha256 {
  private readonly h: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;
  constructor(secret?: string | ArrayBuffer | ArrayBufferView) {
    this.h = secret ? createHmac("sha256", toBuf(secret)) : createHash("sha256");
  }
  update(data: string | ArrayBuffer | ArrayBufferView) {
    this.h.update(toBuf(data));
  }
  async digest() {
    return new Uint8Array(this.h.digest());
  }
  reset() {}
}

function parseAmzDate(v: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (!m) throw new Error("bad X-Amz-Date");
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

export async function startS3Emulator(opts: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
  port?: number;
}): Promise<S3Emulator> {
  const signer = new SignatureV4({
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    region: opts.region ?? "auto",
    service: "s3",
    sha256: Sha256,
    uriEscapePath: false,
    applyChecksum: false,
  });
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const refused: S3Emulator["refused"] = [];

  async function verify(req: IncomingMessage, url: URL): Promise<string | null> {
    const host = req.headers.host ?? "";
    const [hostname, port] = host.split(":");
    const base = {
      method: req.method!,
      protocol: "http:",
      hostname: hostname!,
      port: port ? Number(port) : undefined,
      path: url.pathname,
    };
    const q = Object.fromEntries(url.searchParams.entries());

    if (q["X-Amz-Signature"]) {
      const signedAt = parseAmzDate(q["X-Amz-Date"] ?? "");
      const expiresIn = Number(q["X-Amz-Expires"]);
      if (Date.now() > signedAt.getTime() + expiresIn * 1000) return "presigned URL expired";
      if (!q["X-Amz-Credential"]?.startsWith(`${opts.accessKeyId}/`)) return "unknown access key";
      const signed = (q["X-Amz-SignedHeaders"] ?? "").split(";");
      const headers: Record<string, string> = {};
      for (const h of signed) headers[h] = String(req.headers[h] ?? "");
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(q)) {
        if (k !== "X-Amz-Signature" && k !== "X-Amz-Content-Sha256") query[k] = v;
      }
      // The presigner signs UNSIGNED-PAYLOAD (carried in the query); give it back as the header
      // the signer reads the payload hash from.
      if (q["X-Amz-Content-Sha256"]) headers["X-Amz-Content-Sha256"] = q["X-Amz-Content-Sha256"];
      const expected = await signer.presign(
        { ...base, query, headers },
        {
          signingDate: signedAt,
          expiresIn,
          signableHeaders: new Set(signed.filter((h) => h !== "host")),
        },
      );
      return expected.query?.["X-Amz-Signature"] === q["X-Amz-Signature"]
        ? null
        : "signature mismatch (signed headers changed?)";
    }

    const auth = req.headers.authorization ?? "";
    const m = /Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
    if (!m) return "missing signature";
    if (!m[1]!.startsWith(`${opts.accessKeyId}/`)) return "unknown access key";
    const signed = m[2]!.split(";");
    const headers: Record<string, string> = {};
    for (const h of signed) headers[h] = String(req.headers[h] ?? "");
    const expected = await signer.sign(
      { ...base, query: q, headers },
      {
        signingDate: parseAmzDate(String(req.headers["x-amz-date"])),
        signableHeaders: new Set(signed),
      },
    );
    const got = /Signature=([0-9a-f]+)/.exec(
      String(expected.headers.authorization ?? expected.headers.Authorization),
    )?.[1];
    return got === m[3] ? null : "signature mismatch";
  }

  const xmlError = (code: string, message: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const reason = await verify(req, url).catch((e: Error) => e.message);
    if (reason) {
      refused.push({ method: req.method!, path: url.pathname, reason });
      res
        .writeHead(403, { "content-type": "application/xml" })
        .end(xmlError("AccessDenied", reason));
      return;
    }
    const prefix = `/${opts.bucket}/`;
    if (!url.pathname.startsWith(prefix)) {
      res
        .writeHead(404, { "content-type": "application/xml" })
        .end(xmlError("NoSuchBucket", "bucket"));
      return;
    }
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (req.method === "PUT") {
      const declared = Number(req.headers["content-length"] ?? body.length);
      if (declared !== body.length) {
        res.writeHead(400).end(xmlError("IncompleteBody", "length mismatch"));
        return;
      }
      objects.set(key, {
        bytes: body,
        contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
      });
      res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` }).end();
      return;
    }
    const obj = objects.get(key);
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    if (!obj) {
      res
        .writeHead(404, { "content-type": "application/xml" })
        .end(xmlError("NoSuchKey", "The specified key does not exist."));
      return;
    }
    res.writeHead(200, { "content-type": obj.contentType, "content-length": obj.bytes.length });
    res.end(req.method === "HEAD" ? undefined : obj.bytes);
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    refused,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
