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

/**
 * The image type to ask a clipboard entry for.
 *
 * A single copied picture is offered in several forms at once, and the choice
 * between them matters: PNG is lossless and universally readable, so it wins
 * where it is offered. Anything else image-shaped will do. The HTML and the
 * plain text that came along are not pictures.
 */
export function pickImageType(types: readonly string[]): string | null {
  const images = types.filter(isImageType);
  if (images.length === 0) return null;
  return images.find((type) => type.toLowerCase() === "image/png") ?? images[0];
}

/** As much of a clipboard entry as reading a picture out of it needs. */
export interface ClipboardEntry {
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
}

/**
 * The pictures on the system clipboard, read on purpose rather than caught.
 *
 * The keyboard shortcut hands us a paste event with the files already on it.
 * A button has to go and ask, which is a different browser interface, may
 * raise a permission prompt, and is not implemented everywhere. So this reads
 * what it can and the caller falls back to telling somebody to press the keys,
 * which always works.
 */
export async function readClipboardImages(entries: readonly ClipboardEntry[]): Promise<File[]> {
  const found: File[] = [];
  for (const entry of entries) {
    const type = pickImageType(entry.types);
    if (!type) continue;
    try {
      const blob = await entry.getType(type);
      found.push(new File([blob], `pasted.${extensionForImage(type)}`, { type }));
    } catch {
      // One unreadable entry is not a reason to drop the others.
    }
  }
  return found;
}

/**
 * The picture behind a copied piece of a document.
 *
 * Copying an image out of Google Docs, a web page or an email does not put an
 * image on the clipboard at all. It puts the HTML that was holding the image,
 * with the picture itself left where it was and referred to by address. So the
 * clipboard says "no picture here" while the person doing the copying is
 * looking straight at one.
 *
 * The address is in that HTML, and it is one of two things: the picture
 * spelled out in the link itself, or a link to somewhere it is stored.
 */
export function imageUrlFromHtml(html: string): string | null {
  const match = html.match(/<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  if (!raw) return null;
  // The HTML on a clipboard is HTML, so an ampersand in a query string arrives
  // escaped and the address does not work until it is put back.
  const url = raw.trim().replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return url || null;
}

/** A picture spelled out in the address itself rather than stored somewhere. */
export function isDataImageUrl(url: string): boolean {
  return /^data:image\//i.test(url.trim());
}

/**
 * A picture read out of a data address.
 *
 * Base64 only. The other encoding a data address can use is percent-escaping,
 * which nothing puts a photograph in.
 */
export function fileFromDataUrl(url: string, name = "pasted"): File | null {
  const match = url.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (!match) return null;
  const [, type, base64] = match;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length === 0) return null;
    return new File([bytes], `${name}.${extensionForImage(type)}`, { type });
  } catch {
    return null;
  }
}

/**
 * Whether an address is one we are willing to go and fetch.
 *
 * Somebody's clipboard is not a trusted source of addresses, and fetching one
 * happens on our server with our network. So: only the public web over https,
 * and nothing pointing back inside. A hostname with no dot in it is a machine
 * on a local network; an address written as numbers is one being written as
 * numbers for a reason.
 */
export function isFetchableImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  // An IPv4 address, or an IPv6 one in its brackets.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.startsWith("[")) return false;
  return true;
}
