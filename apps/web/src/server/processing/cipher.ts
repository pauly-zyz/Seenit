import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/**
 * Envelope encryption (AES-256-GCM) for the dispute archive and small secrets.
 *
 * Each payload gets a fresh 256-bit data key; the data key is wrapped with the server master
 * key. `context` (e.g. "submission:<id>") is bound as associated data, so a ciphertext cannot be
 * swapped onto another record. Layout:
 *
 *   "SNE1" | keyIdLen(1) keyId | wrapIv(12) wrapTag(16) wrappedKey(32) | dataIv(12) | ciphertext | dataTag(16)
 */
const MAGIC = Buffer.from("SNE1");
const IV = 12;
const TAG = 16;
const KEY = 32;

export class MediaCipher {
  private readonly keys: Map<string, Buffer>;

  /** `keys`: key id → 32-byte key. New data is encrypted with `activeKeyId`; old ids still decrypt. */
  constructor(
    private readonly activeKeyId: string,
    keys: Record<string, Buffer>,
  ) {
    this.keys = new Map(Object.entries(keys));
    for (const [id, key] of this.keys) {
      if (key.length !== KEY) throw new Error(`Encryption key "${id}" must be 32 bytes`);
      if (!/^[\w.-]{1,32}$/.test(id)) throw new Error(`Invalid encryption key id "${id}"`);
    }
    if (!this.keys.has(activeKeyId)) throw new Error(`Active key "${activeKeyId}" is missing`);
  }

  /** From `MEDIA_ENCRYPTION_KEYS="k2:<base64>,k1:<base64>"` (first = active). */
  static fromEnv(value: string): MediaCipher {
    const entries = value.split(",").map((part) => {
      const [id, b64] = part.trim().split(":");
      if (!id || !b64)
        throw new Error("MEDIA_ENCRYPTION_KEYS must look like id:base64key[,id:base64key]");
      return [id, Buffer.from(b64, "base64")] as const;
    });
    return new MediaCipher(entries[0]![0], Object.fromEntries(entries));
  }

  private header(context: string) {
    const dataKey = randomBytes(KEY);
    const wrapIv = randomBytes(IV);
    const wrap = createCipheriv("aes-256-gcm", this.keys.get(this.activeKeyId)!, wrapIv);
    wrap.setAAD(Buffer.from(`wrap:${context}`));
    const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]);
    const keyId = Buffer.from(this.activeKeyId);
    const dataIv = randomBytes(IV);
    const head = Buffer.concat([
      MAGIC,
      Buffer.from([keyId.length]),
      keyId,
      wrapIv,
      wrap.getAuthTag(),
      wrapped,
      dataIv,
    ]);
    const cipher = createCipheriv("aes-256-gcm", dataKey, dataIv);
    cipher.setAAD(Buffer.from(context));
    return { head, cipher };
  }

  /** Parses the header and returns a decipher ready for the ciphertext. */
  private openHeader(head: Buffer, context: string) {
    if (!head.subarray(0, 4).equals(MAGIC)) throw new Error("Not a Seenit ciphertext");
    const idLen = head[4]!;
    let o = 5;
    const keyId = head.subarray(o, (o += idLen)).toString();
    const master = this.keys.get(keyId);
    if (!master) throw new Error(`Unknown encryption key "${keyId}"`);
    const wrapIv = head.subarray(o, (o += IV));
    const wrapTag = head.subarray(o, (o += TAG));
    const wrapped = head.subarray(o, (o += KEY));
    const dataIv = head.subarray(o, (o += IV));
    const unwrap = createDecipheriv("aes-256-gcm", master, wrapIv);
    unwrap.setAAD(Buffer.from(`wrap:${context}`));
    unwrap.setAuthTag(wrapTag);
    const dataKey = Buffer.concat([unwrap.update(wrapped), unwrap.final()]);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, dataIv);
    decipher.setAAD(Buffer.from(context));
    return { decipher, headerLength: o };
  }

  encrypt(plain: Buffer, context: string): Buffer {
    const { head, cipher } = this.header(context);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([head, body, cipher.getAuthTag()]);
  }

  decrypt(data: Buffer, context: string): Buffer {
    const { decipher, headerLength } = this.openHeader(data, context);
    decipher.setAuthTag(data.subarray(data.length - TAG));
    return Buffer.concat([
      decipher.update(data.subarray(headerLength, data.length - TAG)),
      decipher.final(),
    ]);
  }

  encryptString(plain: string, context: string): string {
    return this.encrypt(Buffer.from(plain, "utf8"), context).toString("base64");
  }

  decryptString(data: string, context: string): string {
    return this.decrypt(Buffer.from(data, "base64"), context).toString("utf8");
  }

  /** Streams `src` into an encrypted `dest` (constant memory, for large videos). */
  async encryptFile(src: string, dest: string, context: string): Promise<void> {
    const { head, cipher } = this.header(context);
    const out = createWriteStream(dest);
    out.write(head);
    await pipeline(createReadStream(src), cipher, out, { end: false });
    await new Promise<void>((resolve, reject) => {
      out.end(cipher.getAuthTag(), () => resolve());
      out.once("error", reject);
    });
  }

  /** Streams an encrypted `src` back to plaintext `dest`. Throws if it was tampered with. */
  async decryptFile(src: string, dest: string, context: string): Promise<void> {
    const size = (await stat(src)).size;
    const fh = await open(src, "r");
    const probe = Buffer.alloc(Math.min(size, 128));
    const tag = Buffer.alloc(TAG);
    try {
      await fh.read(probe, 0, probe.length, 0);
      await fh.read(tag, 0, TAG, size - TAG);
    } finally {
      await fh.close();
    }
    const { decipher, headerLength } = this.openHeader(probe, context);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(src, { start: headerLength, end: size - TAG - 1 }),
      decipher,
      createWriteStream(dest),
    );
  }
}
