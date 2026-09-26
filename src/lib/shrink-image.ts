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
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // Screenshots are mostly white text on white; a white ground keeps a
    // transparent PNG from turning black in the JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
