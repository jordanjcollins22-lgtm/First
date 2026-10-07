/**
 * Where a stored image lives, and how big a copy of it to ask for.
 *
 * Photos in this app arrive at whatever size the phone took them — three or
 * four megabytes each is normal. Rendering one of those into a 96px square
 * costs the person looking at it the entire download, and the pages that show
 * photos show a dozen at once, on a phone, often on site.
 *
 * Supabase will hand back a resized copy instead: the same object served from
 * /render/image rather than /object, with the size and quality in the query
 * string. It renders each distinct variant once and caches it behind its own
 * CDN, so asking for a thumbnail is not a resize per request — it is a resize
 * per size, ever.
 *
 * This is deliberately a pure function of its arguments: no Supabase client,
 * no environment read, nothing to construct or await. That is what makes it
 * testable, and it is also why the URL shape lives here rather than being
 * concatenated at each call site — one place to be wrong, rather than nine.
 *
 * The output matches what the Supabase client's own getPublicUrl produces,
 * character for character, so switching a call site over does not silently
 * change the URL of an image that is already cached everywhere.
 */

export interface ImageTransform {
  /** Pixels. Given on its own, the height follows the original aspect ratio. */
  width?: number;
  height?: number;
  /**
   * What to do when both dimensions are given and they don't match the
   * original's shape. Supabase defaults to "cover", which crops — leave it
   * alone for anything whose geometry is load-bearing, such as a photo with
   * markers positioned as fractions of the image.
   */
  resize?: "cover" | "contain" | "fill";
  /** 20 to 100. Anything outside that range is refused by Supabase. */
  quality?: number;
}

/** The lowest and highest quality Supabase's renderer accepts. */
const MIN_QUALITY = 20;
const MAX_QUALITY = 100;

/**
 * Both dimensions, always, and never one on its own.
 *
 * The obvious way to ask for a thumbnail is a width and no height, and let the
 * height follow the original's shape. That is what the documentation describes
 * and it is not what this renderer does: given a width alone it pins the width
 * and leaves the height at the original's. A 4032x3024 camera photo asked for
 * at width 320 came back 320x4032 -- the same picture squeezed to a twelfth of
 * its width. Height alone is the same mistake mirrored (3000x240).
 *
 * Nothing downstream can recover from that. `object-contain` faithfully drew
 * the sliver it was given, so a proposal's photos rendered as vertical
 * threads, and it looked like a layout bug in the page rather than a wrong
 * picture arriving from storage.
 *
 * So both dimensions go on every transform, with `contain` to fit inside them.
 * `contain` and not `cover`: cover fills the box by cropping, and a square
 * crop of a wide garden shot is a close-up of the lawn with the beds either
 * side of it removed, which is the part being quoted for. The pair is a
 * bounding box, not a shape -- a portrait photo comes back portrait, fitted.
 */

/**
 * A grid tile. 640 covers a tile a little over 200px across on a
 * three-times-density phone screen, in either orientation.
 */
export const THUMBNAIL: ImageTransform = {
  width: 640,
  height: 640,
  resize: "contain",
  quality: 60,
};

/**
 * A photo filling the width of a phone. Big enough that it doesn't look soft
 * on a retina screen, small enough that it isn't the original four megabytes.
 */
export const PREVIEW: ImageTransform = {
  width: 1280,
  height: 1280,
  resize: "contain",
  quality: 75,
};

function clampQuality(quality: number): number {
  return Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Math.round(quality)));
}

/**
 * Builds the public URL for an object in a public bucket, optionally asking
 * for a resized copy.
 *
 * A transform with nothing in it is treated as no transform at all: it would
 * otherwise route through the renderer for no benefit, and the renderer is
 * the one thing here that can be turned off on a project.
 */
export function publicStorageUrl({
  supabaseUrl,
  bucket,
  path,
  transform,
}: {
  supabaseUrl: string;
  bucket: string;
  path: string;
  transform?: ImageTransform;
}): string {
  const base = supabaseUrl.replace(/\/+$/, "");

  const query = new URLSearchParams();
  if (transform?.width) query.set("width", String(Math.round(transform.width)));
  if (transform?.height) query.set("height", String(Math.round(transform.height)));
  if (transform?.resize) query.set("resize", transform.resize);
  if (transform?.quality) query.set("quality", String(clampQuality(transform.quality)));

  const queryString = query.toString();
  const kind = queryString ? "render/image" : "object";

  // Leading slashes are stripped rather than rejected because callers store
  // paths both ways and a doubled slash is a different object to Supabase.
  const objectPath = `${bucket}/${path.replace(/^\/+/, "")}`;

  return (
    encodeURI(`${base}/storage/v1/${kind}/public/${objectPath}`) +
    (queryString ? `?${queryString}` : "")
  );
}
