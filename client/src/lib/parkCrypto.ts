/**
 * End-to-end encryption for "Park it", using the browser's Web Crypto API.
 *
 * - Each user has an RSA-OAEP key pair. The public key is stored as-is, so a thought can be
 *   parked (encrypted) without asking for the secret code.
 * - The private key is encrypted with AES-256-GCM under a key derived from the secret code
 *   (PBKDF2-SHA256, 600k iterations). The code itself is never stored or sent anywhere.
 * - Each parked thought is encrypted with its own random AES-256-GCM key, which is then
 *   wrapped with the RSA public key (standard hybrid encryption).
 *
 * Without the secret code nobody (not RecallDesk, not the database) can read a parked thought.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("Secure encryption isn't available in this browser.");
  return globalThis.crypto.subtle;
};

export const PBKDF2_ITERATIONS = 600_000;
const RSA = { name: "RSA-OAEP", hash: "SHA-256" } as const;

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n)) as Uint8Array<ArrayBuffer>;

export interface ParkKeys {
  public_key: string;
  wrapped_private_key: string;
  wrap_iv: string;
  salt: string;
  iterations: number;
}

export interface SealedThought {
  ciphertext: string;
  iv: string;
  wrapped_key: string;
}

export class WrongCodeError extends Error {
  constructor() {
    super("That secret code doesn't match.");
  }
}

async function deriveCodeKey(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await subtle().importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** First-time setup: create the key pair and lock the private half with the secret code. */
export async function createParkKeys(code: string): Promise<ParkKeys> {
  const pair = await subtle().generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = await subtle().exportKey("spki", pair.publicKey);
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  const salt = random(16);
  const iv = random(12);
  const codeKey = await deriveCodeKey(code, salt, PBKDF2_ITERATIONS);
  const wrapped = await subtle().encrypt({ name: "AES-GCM", iv }, codeKey, pkcs8);
  return {
    public_key: toB64(spki),
    wrapped_private_key: toB64(wrapped),
    wrap_iv: toB64(iv),
    salt: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

/** Encrypt a thought with the public key. Needs no secret code. */
export async function sealThought(text: string, publicKey: string): Promise<SealedThought> {
  const pub = await subtle().importKey("spki", fromB64(publicKey), RSA, false, ["encrypt"]);
  const aesKey = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = random(12);
  const ciphertext = await subtle().encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(text));
  const rawKey = await subtle().exportKey("raw", aesKey);
  const wrappedKey = await subtle().encrypt(RSA, pub, rawKey);
  return { ciphertext: toB64(ciphertext), iv: toB64(iv), wrapped_key: toB64(wrappedKey) };
}

/** Unlock the private key with the secret code. Throws WrongCodeError if the code is wrong. */
export async function unlockParkKey(code: string, keys: ParkKeys): Promise<CryptoKey> {
  const codeKey = await deriveCodeKey(code, fromB64(keys.salt), keys.iterations);
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(keys.wrap_iv) }, codeKey, fromB64(keys.wrapped_private_key));
  } catch {
    throw new WrongCodeError();
  }
  return subtle().importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
}

/** Decrypt one parked thought with an unlocked private key. */
export async function openThought(sealed: SealedThought, privateKey: CryptoKey): Promise<string> {
  const rawKey = await subtle().decrypt(RSA, privateKey, fromB64(sealed.wrapped_key));
  const aesKey = await subtle().importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, aesKey, fromB64(sealed.ciphertext));
  return dec.decode(plain);
}
