import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { MediaStorage } from "./types";

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Cloudflare R2 through its S3-compatible API. */
export class R2Storage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: R2Options) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async presignUpload(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    // Content-Type and Content-Length are signed, so the client can't swap type or size.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT" as const,
      headers: { "content-type": opts.contentType, "content-length": String(opts.contentLength) },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async presignDownload(key: string, expiresInSeconds: number) {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      {
        expiresIn: expiresInSeconds,
      },
    );
    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async sha256(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of res.Body as Readable) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
      }
      return { sha256: hash.digest("hex"), size, contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async download(key: string, destPath: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      await pipeline(res.Body as Readable, createWriteStream(destPath));
      return { size: (await stat(destPath)).size, contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async upload(key: string, body: Buffer | { path: string }, contentType: string) {
    const isFile = !Buffer.isBuffer(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        Body: isFile ? createReadStream(body.path) : body,
        ContentLength: isFile ? (await stat(body.path)).size : body.length,
      }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
