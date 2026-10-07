/**
 * A picture's fingerprint.
 *
 * SHA-256 of the bytes, hex. The same screenshot saved twice from the same
 * phone has the same bytes; one cropped or re-saved does not, and that is
 * accepted: the aim is to stop the plain double-tap, not to compare pictures.
 * Web Crypto is in every browser and in Node, so the same function runs on
 * the phone before an upload and on the server behind it.
 */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function looksLikeHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
