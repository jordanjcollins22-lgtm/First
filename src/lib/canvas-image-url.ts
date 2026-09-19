import { env } from "@/lib/env";
import { publicStorageUrl, type ImageTransform } from "@/lib/storage-image-url";

/**
 * The URL of a photo or canvas image for a job.
 *
 * The "canvas-images" bucket is public, so this is pure URL construction —
 * no auth, no network call, nothing to await. It used to go through a
 * Supabase client built on first use, purely because createClient throws
 * without credentials and a page that merely imported this file would
 * otherwise fail to build anywhere that has none. publicStorageUrl needs the
 * project URL and nothing else, so that dance is gone.
 *
 * Pass a transform — THUMBNAIL or PREVIEW from storage-image-url — anywhere
 * the image is displayed smaller than it was taken. A grid of tiles rendered
 * from the originals is several megabytes of download to fill a few hundred
 * pixels, which is felt hardest by the person standing in a driveway on their
 * own data.
 */
export function canvasImageUrl(path: string, transform?: ImageTransform): string {
  return publicStorageUrl({
    supabaseUrl: env.supabaseUrl,
    bucket: "canvas-images",
    path,
    transform,
  });
}
