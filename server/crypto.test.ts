import { describe, expect, it } from "vitest";
import { decryptString, encryptString, randomToken, sha256Hex, timingSafeEqual } from "./crypto";

const KEY = Buffer.from("dev-key-dev-key-dev-key-dev-key!").toString("base64");
const OTHER = Buffer.alloc(32, 7).toString("base64");

describe("AES-256-GCM token encryption", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptString(KEY, "secret-token");
    const b = await encryptString(KEY, "secret-token");
    expect(a).not.toBe(b);
    expect(await decryptString(KEY, a)).toBe("secret-token");
    expect(await decryptString(KEY, b)).toBe("secret-token");
    expect(a).not.toContain("secret-token");
  });

  it("rejects tampering and the wrong key", async () => {
    const enc = await encryptString(KEY, "secret-token");
    const bytes = Buffer.from(enc, "base64");
    bytes[bytes.length - 1]! ^= 0x01;
    await expect(decryptString(KEY, bytes.toString("base64"))).rejects.toBeTruthy();
    await expect(decryptString(OTHER, enc)).rejects.toBeTruthy();
  });

  it("rejects keys that are not 32 bytes", async () => {
    await expect(encryptString(Buffer.from("short").toString("base64"), "x")).rejects.toThrow(/32 bytes/);
  });
});

describe("helpers", () => {
  it("sha256Hex is stable; randomToken is url-safe and unique; timingSafeEqual compares", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t1).not.toBe(t2);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });
});
