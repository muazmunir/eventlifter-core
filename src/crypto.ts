import crypto from "crypto";

/**
 * Credential encryption (AES-256-GCM). Channel tokens/keys are encrypted before
 * they touch storage and decrypted only in memory when a job needs them.
 *
 * This derives a key from CREDENTIALS_KMS_KEY. In production, replace the
 * derivation with a real KMS data key (envelope encryption); the encrypt/decrypt
 * shape stays the same.
 */

const SECRET = process.env.CREDENTIALS_KMS_KEY || "dev-only-insecure-key-change-me";
// fixed salt is fine here because the secret is the real entropy source
const KEY = crypto.scryptSync(SECRET, "eventlifter.salt.v1", 32);

if (!process.env.CREDENTIALS_KMS_KEY) {
  console.warn("[crypto] CREDENTIALS_KMS_KEY not set — using an insecure dev key. Do NOT use in production.");
}

/** Encrypt a JSON-serializable object → Buffer (iv | tag | ciphertext). */
export function encryptJson(obj: unknown): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/** Decrypt a Buffer produced by encryptJson back into the original object. */
export function decryptJson<T = Record<string, string>>(buf: Buffer): T {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
