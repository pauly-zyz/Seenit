import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { R2Storage } from "../../../apps/web/src/server/storage/r2";
import { startS3Emulator, type S3Emulator } from "../src/s3-emulator";

const creds = {
  accessKeyId: "e2e-access",
  secretAccessKey: "e2e-secret-key-that-is-long",
  bucket: "seenit-e2e",
};
let s3: S3Emulator;
let storage: R2Storage;

beforeAll(async () => {
  s3 = await startS3Emulator(creds);
  storage = new R2Storage({ accountId: "local", ...creds, endpoint: s3.url });
});
afterAll(() => s3.close());

describe("S3 emulator + R2Storage", () => {
  it("accepts a PUT to a presigned URL with exactly the signed headers", async () => {
    const body = Buffer.from("photo bytes");
    const up = await storage.presignUpload("submissions/a/original", {
      contentType: "image/jpeg",
      contentLength: body.length,
      expiresInSeconds: 60,
    });
    const res = await fetch(up.url, { method: "PUT", headers: up.headers, body });
    expect(res.status).toBe(200);
    expect((await storage.sha256("submissions/a/original"))?.sha256).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
  });

  it("refuses a different content type or size than was signed", async () => {
    const up = await storage.presignUpload("submissions/b/original", {
      contentType: "image/jpeg",
      contentLength: 5,
      expiresInSeconds: 60,
    });
    const swapped = await fetch(up.url, {
      method: "PUT",
      headers: { ...up.headers, "content-type": "text/html" },
      body: "hello",
    });
    expect(swapped.status).toBe(403);
    const bigger = await fetch(up.url, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: "hello world, much bigger",
    });
    expect(bigger.status).toBe(403);
    expect(s3.objects.has("submissions/b/original")).toBe(false);
  });

  it("refuses expired URLs and unsigned requests", async () => {
    const up = await storage.presignUpload("submissions/c/original", {
      contentType: "image/jpeg",
      contentLength: 1,
      expiresInSeconds: 1,
    });
    await new Promise((r) => setTimeout(r, 2100));
    expect((await fetch(up.url, { method: "PUT", headers: up.headers, body: "x" })).status).toBe(
      403,
    );
    expect((await fetch(`${s3.url}/${creds.bucket}/submissions/a/original`)).status).toBe(403);
    expect(s3.refused.some((r: { reason: string }) => r.reason === "presigned URL expired")).toBe(
      true,
    );
  });

  it("serves the SDK operations the API and worker use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "s3e-"));
    await writeFile(join(dir, "in"), "archive bytes");
    await storage.upload("disputes/x.enc", { path: join(dir, "in") }, "application/octet-stream");
    await storage.upload("blurred/x/frame-0.jpg", Buffer.from("jpeg"), "image/jpeg");
    expect(await storage.download("disputes/x.enc", join(dir, "out"))).toMatchObject({ size: 13 });
    expect(await readFile(join(dir, "out"), "utf8")).toBe("archive bytes");
    const get = await storage.presignDownload("blurred/x/frame-0.jpg", 60);
    expect(await (await fetch(get.url)).text()).toBe("jpeg");
    await storage.delete("disputes/x.enc");
    expect(await storage.download("disputes/x.enc", join(dir, "gone"))).toBeNull();
    expect(await storage.sha256("nope")).toBeNull();
  });
});
