/**
 * Reading a client's emailed reply: who sent it and what they actually wrote.
 *
 * A reply carries everything it replied to underneath it, our own proposal
 * email included. The thread already has that, so only the new part is kept:
 * everything above the "On ... wrote:" line, or the first quoted line, or the
 * phone's "Sent from my iPhone". Pure, so it is tested on real-shaped mail.
 */

/** The bare address out of "Sarah Miller <sarah@example.com>", lower-cased. */
export function senderAddress(from: string | null | undefined): string | null {
  const raw = (from ?? "").trim();
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

/** The domain an address is at. */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/** Plain text from an HTML body, for the mail apps that send no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_STARTS: RegExp[] = [
  /^On .+(\n.+)?wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^_{5,}\s*$/m,
  /^From:\s.+$/m,
  /^>/m,
  /^Sent from my (iPhone|iPad|Android|Galaxy|phone)/im,
  /^Get Outlook for /im,
];

/** What the client wrote, without what they were replying to. */
export function replyText(text: string | null | undefined, html?: string | null): string {
  const body = (text && text.trim() ? text : html ? htmlToText(html) : "").replace(/\r\n/g, "\n");
  let cut = body.length;
  for (const pattern of QUOTE_STARTS) {
    const match = pattern.exec(body);
    if (match && match.index < cut) cut = match.index;
  }
  const kept = body.slice(0, cut).trim();
  // A reply that is nothing but a quote (or a forward) is shown whole rather than as nothing.
  return kept || body.trim();
}

/**
 * Whether the receiving server's own checks say the sender is who they claim.
 * A message that fails both SPF and DKIM is somebody else using a client's
 * address, and must not be put in that client's thread. Unknown passes, so a
 * missing result never loses a real reply.
 */
export function looksForged(auth: { spf?: string | null; dkim?: string | null } | null | undefined): boolean {
  if (!auth) return false;
  return auth.spf === "fail" && auth.dkim === "fail";
}
