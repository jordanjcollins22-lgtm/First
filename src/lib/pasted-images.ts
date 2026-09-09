/**
 * Photographs arriving by paste rather than by file picker.
 *
 * An evaluator back at a desk has the photograph on a screen already: in a
 * text message, in an email, in a screenshot they just took, on a listing
 * page. Getting it onto a zone meant saving it to disk, finding the folder in
 * a file picker and hoping they picked the right one out of eleven files all
 * called IMG_4471. Copy and paste is the gesture people already use for this
 * everywhere else, and the browser hands us the file.
 *
 * What is here is the awkward part. A clipboard is a bag of representations of
 * one thing: an image copied from a web page arrives as an image and as the
 * HTML that held it, and a screenshot arrives with no filename at all. So the
 * images are picked out, and each one is given a name and an extension it can
 * be stored under.
 */

/** As much of a clipboard item as picking images out of it needs. */
export interface ClipboardLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }> | null;
  files?: ArrayLike<File> | null;
}

/** The file extension to store a pasted image under. */
export function extensionForImage(type: string, fileName?: string): string {
  const subtype = type.toLowerCase().split("/")[1]?.split("+")[0]?.trim();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg") return "svg";
  if (subtype && /^[a-z0-9]{1,5}$/.test(subtype)) return subtype;

  // A file dragged in rather than pasted may have a name and no useful type.
  const fromName = fileName?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;

  // A screenshot with neither is a PNG far more often than it is anything
  // else, and a wrong extension on a stored file is worse than a guess that
  // is usually right: the browser reads the bytes, not the name.
  return "png";
}

/** Whether this is a picture rather than the text or HTML that came with it. */
export function isImageType(type: string): boolean {
  return type.toLowerCase().startsWith("image/");
}

/**
 * The images on a clipboard, and nothing else.
 *
 * Both shapes are read because browsers disagree: Safari fills `files` on a
 * paste, Chrome fills `items`, and pasting a copied web image fills both with
 * the same picture. So they are gathered together and the duplicates dropped,
 * matched on size and type, which is as close to identity as two File objects
 * for one picture get.
 */
export function imagesFromClipboard(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];

  const found: File[] = [];
  const push = (file: File | null) => {
    if (!file || !isImageType(file.type)) return;
    if (found.some((seen) => seen.size === file.size && seen.type === file.type)) return;
    found.push(file);
  };

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !isImageType(item.type)) continue;
    push(item.getAsFile());
  }
  for (const file of Array.from(data.files ?? [])) push(file);

  return found;
}

/**
 * Whether a paste belongs to whatever is being typed into rather than to us.
 *
 * Somebody pasting an address into the notes box is pasting into the notes
 * box. Only a paste with nowhere else to go is a photograph for the zone.
 */
export function pasteIsForTyping(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object" || !("tagName" in target)) return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tag = String(element.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}
