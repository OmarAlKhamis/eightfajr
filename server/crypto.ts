// AES-256-GCM at rest for Eight Sleep tokens, plus small hashing helpers.
// WebCrypto only — runs identically in Workers and Node (tests).

const keyCache = new Map<string, Promise<CryptoKey>>();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function importKey(keyB64: string): Promise<CryptoKey> {
  let p = keyCache.get(keyB64);
  if (!p) {
    const raw = b64ToBytes(keyB64);
    if (raw.length !== 32) {
      p = Promise.reject(new Error("TOKEN_ENCRYPTION_KEY must be base64 of exactly 32 bytes"));
      p.catch(() => {}); // avoid unhandled rejection noise; callers re-await
    } else {
      p = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }
    keyCache.set(keyB64, p);
  }
  return p;
}

/** Returns base64( iv[12] || ciphertext+tag ). A fresh random IV per call. */
export async function encryptString(keyB64: string, plaintext: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToB64(out);
}

export async function decryptString(keyB64: string, payloadB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const buf = b64ToBytes(payloadB64);
  if (buf.length < 13) throw new Error("ciphertext too short");
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** URL-safe random token (32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newId(): string {
  return crypto.randomUUID();
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
