// @vitest-environment node
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MediaCipher } from "../processing/cipher";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const cipher = new MediaCipher("k1", { k1 });

describe("MediaCipher", () => {
  it("round-trips buffers and strings with a fresh data key each time", () => {
    const plain = Buffer.from("original media bytes");
    const a = cipher.encrypt(plain, "submission:1");
    const b = cipher.encrypt(plain, "submission:1");
    expect(a.equals(b)).toBe(false);
    expect(a.includes(plain)).toBe(false);
    expect(cipher.decrypt(a, "submission:1").equals(plain)).toBe(true);
    expect(cipher.decryptString(cipher.encryptString("whsec_x", "ctx"), "ctx")).toBe("whsec_x");
  });

  it("rejects tampering and the wrong context", () => {
    const data = cipher.encrypt(Buffer.from("hello"), "submission:1");
    expect(() => cipher.decrypt(data, "submission:2")).toThrow();
    const flipped = Buffer.from(data);
    flipped[flipped.length - 20]! ^= 0xff;
    expect(() => cipher.decrypt(flipped, "submission:1")).toThrow();
  });

  it("streams large files and detects tampering in them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seenit-cipher-"));
    try {
      const src = join(dir, "src");
      const enc = join(dir, "enc");
      const out = join(dir, "out");
      const plain = randomBytes(3 * 1024 * 1024 + 17);
      await writeFile(src, plain);
      await cipher.encryptFile(src, enc, "submission:big");
      expect((await readFile(enc)).length).toBe(plain.length + 4 + 1 + 2 + 12 + 16 + 32 + 12 + 16);
      await cipher.decryptFile(enc, out, "submission:big");
      expect((await readFile(out)).equals(plain)).toBe(true);
      // The in-memory format is the same as the streamed one.
      expect(cipher.decrypt(await readFile(enc), "submission:big").equals(plain)).toBe(true);

      const bad = await readFile(enc);
      bad[200]! ^= 1;
      await writeFile(enc, bad);
      await expect(cipher.decryptFile(enc, out, "submission:big")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports key rotation: new key encrypts, old key still decrypts", () => {
    const old = cipher.encrypt(Buffer.from("legacy"), "c");
    const rotated = MediaCipher.fromEnv(`k2:${k2.toString("base64")},k1:${k1.toString("base64")}`);
    expect(rotated.decrypt(old, "c").toString()).toBe("legacy");
    const fresh = rotated.encrypt(Buffer.from("new"), "c");
    expect(() => cipher.decrypt(fresh, "c")).toThrow(/Unknown encryption key "k2"/);
  });

  it("validates keys", () => {
    expect(() => new MediaCipher("a", { a: Buffer.alloc(16) })).toThrow(/32 bytes/);
    expect(() => MediaCipher.fromEnv("nokey")).toThrow();
  });
});
