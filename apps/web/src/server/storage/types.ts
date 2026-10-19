export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Headers the client must send exactly (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

/** S3-compatible object storage (Cloudflare R2 in production, in-memory in tests). */
export interface MediaStorage {
  presignUpload(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<PresignedUpload>;
  presignDownload(key: string, expiresInSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  /** Streams the object and hashes it. Null when the object does not exist. */
  sha256(key: string): Promise<{ sha256: string; size: number; contentType?: string } | null>;
  /** Streams the object to a local file. Null when the object does not exist. */
  download(key: string, destPath: string): Promise<{ size: number; contentType?: string } | null>;
  /** Writes an object from memory or from a local file. */
  upload(key: string, body: Buffer | { path: string }, contentType: string): Promise<void>;
  /** Deletes an object (no error if it is already gone). */
  delete(key: string): Promise<void>;
}
