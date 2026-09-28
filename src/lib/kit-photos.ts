import { env } from "@/lib/env";

/**
 * Where a kit photo is seen from. The tool-images bucket is public, so this
 * is a plain URL rather than a signed one, and it works on the crew's phone
 * and in a demo alike.
 */
export function kitPhotoUrl(path: string): string {
  const base = env.supabaseUrl.replace(/\/$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/tool-images/${encoded}`;
}

/** Kit photos live in their own folder of the tool bucket, one folder per business. */
export function kitPhotoFolder(organizationId: string): string {
  return `kits/${organizationId}/`;
}
