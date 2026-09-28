/**
 * A screenshot made small enough to send, on the phone, before it goes.
 *
 * A phone screenshot is three or four megabytes of PNG, most of it white.
 * Uploading that on a garden's worth of signal is the slowest part of the
 * whole form, and the model reads a 1200 pixel JPEG just as well. So the
 * picture is redrawn smaller and re-saved before the upload starts. The
 * original's fingerprint is still taken first, so the duplicate check keeps
 * matching what was actually on the phone.
 *
 * Browser only: it draws on a canvas.
 */

export const SHRINK_MAX_EDGE = 1280;
export const SHRINK_ABOVE_BYTES = 350 * 1024;

export async function shrinkImage(file: File, maxEdge = SHRINK_MAX_EDGE, quality = 0.85): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  if (typeof document === "undefined") return file;

  const picture = await decode(file);
  if (!picture) return file;
  try {
    const longest = Math.max(picture.width, picture.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // Screenshots are mostly white text on white; a white ground keeps a
    // transparent PNG from turning black in the JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(picture.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    // A HEIC the browser could draw is still worth turning into a JPEG,
    // even if it came out no smaller: nothing else can open a HEIC.
    if (!blob || (blob.size >= file.size && !isHeic(file))) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    picture.close();
  }
}

export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/**
 * The picture, drawable. createImageBitmap first, turned the right way up;
 * where the phone's browser can't do that with a camera photo (older
 * iPhones), an ordinary image element, which can open anything the phone
 * can show.
 */
async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the image element.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
