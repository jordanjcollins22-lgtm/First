/**
 * Every message a person sends the business through GoHighLevel, in one
 * shape, whichever way it reached us.
 *
 * Two roads bring a message in. The fast one: a GoHighLevel workflow on
 * "Customer Replied" posts it to /api/webhooks/ghl-message the moment it
 * lands. The sure one: the database's timer calls /api/cron/ghl-inbox-sweep
 * every minute, which asks GoHighLevel for recently active conversations
 * and picks up any inbound message the webhook never delivered. Both hand
 * their message to captureInbound (lib/ghl/capture.ts), which keeps one row
 * per GoHighLevel message id, so a message that arrives both ways is kept
 * and announced once.
 *
 * The functions here are pure: they read loosely shaped JSON and decide,
 * nothing more, so they can be tested without a database or the network.
 */

export interface InboundMessage {
  /** GoHighLevel's id for the message. The key that stops doubles. */
  ghlMessageId: string | null;
  conversationId: string | null;
  contactId: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  /** SMS, Email, FB, IG, GMB, Live_Chat, WhatsApp, Call... as GoHighLevel names it. */
  channel: string;
  body: string;
  receivedAt: string;
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function str(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** GoHighLevel's message type, numeric or named, as one readable word. */
const TYPE_NAMES: Record<string, string> = {
  "1": "Call",
  "2": "SMS",
  "3": "Email",
  "4": "SMS",
  "5": "SMS",
  "6": "SMS",
  "7": "Review",
  "8": "SMS",
  "9": "SMS",
  "10": "SMS",
  "11": "FB",
  "12": "SMS",
  "13": "Email",
  "14": "GMB",
  "18": "IG",
  "19": "WhatsApp",
  "29": "Live_Chat",
};

export function channelName(raw: unknown): string {
  const value = str(raw);
  if (!value) return "SMS";
  if (TYPE_NAMES[value]) return TYPE_NAMES[value];
  const cleaned = value.replace(/^TYPE_/i, "").replace(/\s+/g, "_");
  const upper = cleaned.toUpperCase();
  if (upper === "SMS" || upper === "PHONE") return "SMS";
  if (upper === "EMAIL") return "Email";
  if (upper === "FACEBOOK" || upper === "FB") return "FB";
  if (upper === "INSTAGRAM" || upper === "IG") return "IG";
  if (upper === "GMB" || upper === "GOOGLE") return "GMB";
  if (upper === "LIVE_CHAT" || upper === "WEBCHAT" || upper === "CHAT") return "Live_Chat";
  if (upper === "WHATSAPP") return "WhatsApp";
  if (upper === "CALL") return "Call";
  return cleaned;
}

function isoOrNow(value: unknown, now: Date): string {
  const s = str(value);
  if (s) {
    const asNumber = /^\d{10,}$/.test(s) ? Number(s) : NaN;
    const d = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return now.toISOString();
}

/**
 * A webhook body from GoHighLevel, as an inbound message, or null when it
 * is not one (our own outbound message, a step with nothing in it).
 *
 * Field names are matched loosely because the body depends on how the
 * workflow was built: the Webhook action sends the contact's standard
 * fields plus `message: { body, type }`; a marketplace InboundMessage
 * event sends `messageId`, `body`, `messageType` flat; a Custom Webhook
 * action sends whatever keys somebody typed.
 */
export function parseWebhook(payload: unknown, now = new Date()): InboundMessage | null {
  const p = obj(payload);
  const message = obj(p.message);
  const contact = obj(p.contact);
  const custom = obj(p.customData);

  const direction = (str(p.direction) ?? str(message.direction) ?? str(custom.direction) ?? "inbound").toLowerCase();
  if (direction === "outbound") return null;
  const eventType = str(p.type);
  if (eventType && /^outbound/i.test(eventType)) return null;

  const body =
    (typeof p.message === "string" ? str(p.message) : null) ??
    str(message.body) ??
    str(p.body) ??
    str(p.text) ??
    str(custom.message) ??
    str(custom.body);
  if (!body) return null;

  const name =
    str(contact.name) ??
    str(p.full_name) ??
    str(p.contact_name) ??
    ([str(p.first_name), str(p.last_name)].filter(Boolean).join(" ") || null) ??
    str(p.name);

  return {
    ghlMessageId: str(p.messageId) ?? str(message.id) ?? str(message.messageId) ?? str(custom.message_id),
    conversationId: str(p.conversationId) ?? str(message.conversationId) ?? str(custom.conversation_id),
    contactId: str(p.contactId) ?? str(p.contact_id) ?? str(contact.id) ?? str(custom.contact_id),
    phone: str(p.phone) ?? str(contact.phone) ?? str(p.from) ?? str(custom.phone),
    email: str(p.email) ?? str(contact.email) ?? str(custom.email),
    name,
    channel: channelName(message.type ?? p.messageType ?? custom.channel ?? (eventType && eventType !== "InboundMessage" ? eventType : null)),
    body,
    receivedAt: isoOrNow(p.dateAdded ?? message.dateAdded ?? p.date_created, now),
  };
}

export interface SweepConversation {
  id: string;
  contactId: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  lastMessageAt: string | null;
  lastDirection: string | null;
}

/** A conversation from GET /conversations/search, or null if unreadable. */
export function parseConversation(raw: unknown): SweepConversation | null {
  const c = obj(raw);
  const id = str(c.id);
  if (!id) return null;
  const last = c.lastMessageDate ?? c.dateUpdated;
  return {
    id,
    contactId: str(c.contactId),
    phone: str(c.phone),
    email: str(c.email),
    name: str(c.fullName) ?? str(c.contactName) ?? str(c.name),
    lastMessageAt: last === undefined || last === null ? null : isoOrNow(last, new Date(0)),
    lastDirection: str(c.lastMessageDirection)?.toLowerCase() ?? null,
  };
}

/** The conversations worth opening: anything active since the cutoff. */
export function conversationsToOpen(conversations: SweepConversation[], since: Date): SweepConversation[] {
  return conversations.filter((c) => {
    if (!c.lastMessageAt) return true;
    return new Date(c.lastMessageAt).getTime() >= since.getTime();
  });
}

/**
 * The inbound messages in one conversation's message list, newer than the
 * cutoff. GoHighLevel nests the list as `{ messages: { messages: [...] } }`;
 * a flat `{ messages: [...] }` is read as well.
 */
export function inboundFromMessages(
  payload: unknown,
  conversation: SweepConversation,
  since: Date
): InboundMessage[] {
  const p = obj(payload);
  const nested = obj(p.messages);
  const list = Array.isArray(p.messages) ? p.messages : Array.isArray(nested.messages) ? nested.messages : [];
  const out: InboundMessage[] = [];
  for (const raw of list as unknown[]) {
    const m = obj(raw);
    if ((str(m.direction) ?? "").toLowerCase() !== "inbound") continue;
    const kind = str(m.messageType) ?? str(m.type);
    // Activity rows (a stage moved, a call logged by the system) are not
    // somebody writing to us.
    if (kind && /ACTIVITY|CAMPAIGN|NO_SHOW|CUSTOM_PROVIDER_EMAIL_SYSTEM/i.test(kind)) continue;
    const receivedAt = isoOrNow(m.dateAdded, new Date(0));
    if (new Date(receivedAt).getTime() < since.getTime()) continue;
    const attachments = Array.isArray(m.attachments) ? m.attachments.length : 0;
    const body =
      str(m.body) ??
      (attachments > 0 ? `(sent ${attachments === 1 ? "a photo or file" : `${attachments} photos or files`})` : null) ??
      (channelName(kind) === "Call" ? "(phone call)" : null);
    if (!body) continue;
    out.push({
      ghlMessageId: str(m.id),
      conversationId: str(m.conversationId) ?? conversation.id,
      contactId: str(m.contactId) ?? conversation.contactId,
      phone: (channelName(kind) === "SMS" ? str(m.from) : null) ?? conversation.phone,
      email: conversation.email,
      name: conversation.name,
      channel: channelName(kind),
      body,
      receivedAt,
    });
  }
  return out;
}

/**
 * Whether the capture needs a person to look at it. Reads the state the
 * sweep keeps: when it last finished cleanly, and how many runs in a row
 * have failed since.
 */
export function captureHealth(
  state: { lastOkAt: string | null; failuresInARow: number },
  now = new Date()
): { ok: boolean; reason: string | null } {
  if (state.failuresInARow >= 3) {
    return { ok: false, reason: `The HighLevel message check has failed ${state.failuresInARow} times in a row.` };
  }
  if (state.lastOkAt) {
    const minutes = (now.getTime() - new Date(state.lastOkAt).getTime()) / 60_000;
    if (minutes > 10) {
      return { ok: false, reason: `The HighLevel message check has not finished in ${Math.round(minutes)} minutes.` };
    }
  }
  return { ok: true, reason: null };
}
