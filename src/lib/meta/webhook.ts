/**
 * Reading what Meta delivers to the message address. Pure, so it is tested
 * without Meta.
 *
 * Meta signs every delivery with the app secret (X-Hub-Signature-256), and a
 * delivery that doesn't check out is refused: anybody can post to a public
 * address, and only Meta knows the secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Whether the body was signed with this app secret. */
export function signatureOk(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IncomingMessage {
  platform: "facebook" | "instagram";
  /** The page id (Facebook) or Instagram account id the message reached. */
  accountId: string;
  /** The other person. */
  contactId: string;
  /** 'in' from the person; 'out' when the page itself sent it (from Facebook's own inbox, say). */
  direction: "in" | "out";
  mid: string;
  text: string | null;
  attachments: { type: string; url: string | null; title: string | null }[];
  at: Date;
}

type Messaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: { type?: string; payload?: { url?: string; title?: string } | null }[];
  };
};

/** Every message in a delivery, in order. Reads, reactions and deletions are left out. */
export function messagesIn(body: unknown): IncomingMessage[] {
  const b = (body ?? {}) as { object?: string; entry?: { id?: string; messaging?: Messaging[] }[] };
  const platform = b.object === "instagram" ? "instagram" : b.object === "page" ? "facebook" : null;
  if (!platform) return [];
  const out: IncomingMessage[] = [];
  for (const entry of b.entry ?? []) {
    const accountId = String(entry.id ?? "");
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_deleted) continue;
      const echo = Boolean(msg.is_echo);
      const contactId = String((echo ? m.recipient?.id : m.sender?.id) ?? "");
      if (!accountId || !contactId) continue;
      out.push({
        platform,
        accountId,
        contactId,
        direction: echo ? "out" : "in",
        mid: msg.mid,
        text: msg.text?.trim() || null,
        attachments: (msg.attachments ?? []).map((a) => ({ type: a.type ?? "file", url: a.payload?.url ?? null, title: a.payload?.title ?? null })),
        at: new Date(typeof m.timestamp === "number" ? m.timestamp : Date.now()),
      });
    }
  }
  return out;
}

/** Whether the person last wrote less than 24 hours ago: Meta only allows a reply inside that window. */
export function insideReplyWindow(lastIncomingAt: Date | null, now: Date = new Date()): boolean {
  return Boolean(lastIncomingAt) && now.getTime() - (lastIncomingAt as Date).getTime() < 24 * 3_600_000;
}
