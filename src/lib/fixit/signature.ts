import { createPublicKey, verify } from "node:crypto";

/**
 * Discord signs every interaction it sends: an Ed25519 signature over the
 * X-Signature-Timestamp header followed by the raw body, made with the
 * application's key. The Developer Portal shows the public half as 64 hex
 * characters. Node wants a key object, so the raw 32 bytes go inside the
 * fixed SPKI header every Ed25519 public key shares.
 *
 * Discord also sends deliberately bad signatures when the endpoint is saved,
 * and refuses the URL unless those get a 401, so this must be strict.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX = /^[0-9a-f]+$/i;

export function discordSignatureOk(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, rawBody: string): boolean {
  if (!signatureHex || !timestamp) return false;
  const key = publicKeyHex.trim();
  if (key.length !== 64 || !HEX.test(key)) return false;
  if (signatureHex.length !== 128 || !HEX.test(signatureHex)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
