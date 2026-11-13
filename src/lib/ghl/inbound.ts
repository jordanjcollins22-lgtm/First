/**
 * Normalize an inbound-message webhook from GoHighLevel. Two shapes are
 * supported:
 *  - Workflow "Customer Replied" trigger -> Webhook action: standard contact
 *    fields (`contact_id`, `phone`, `email`, ...) plus `message: { type, body }`.
 *    Add a Custom Data field `channel` = the message type merge field so the
 *    channel is never guessed.
 *  - Marketplace/app `InboundMessage` event: `contactId`, `body`, `messageType`.
 */

export type Channel =
  | "sms"
  | "email"
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "gmb"
  | "live_chat"
  | "other";

export interface InboundMessage {
  channel: Channel;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  subject: string | null;
  body: string;
}

/** The subset the check-in flow uses. */
export interface InboundSms {
  contactId: string | null;
  phone: string | null;
  body: string;
  messageId: string | null;
}

type Payload = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function obj(value: unknown): Payload {
  return value && typeof value === "object" ? (value as Payload) : {};
}

/** GHL numeric message types seen in workflow webhooks. */
const NUMERIC_TYPES: Record<string, Channel> = { "2": "sms", "3": "email" };

/**
 * Map GHL's many spellings ("SMS", "TYPE_SMS", "Email", "FB", "IG",
 * "TYPE_INSTAGRAM", "WhatsApp", "GMB", "Live_Chat", 2, ...) to one channel.
 */
export function normalizeChannel(raw: string | null): Channel | null {
  if (!raw) return null;
  if (NUMERIC_TYPES[raw]) return NUMERIC_TYPES[raw];
  const t = raw.toLowerCase().replace(/^type_/, "");
  if (t === "sms" || t === "text" || t === "phone") return "sms";
  if (t.includes("email")) return "email";
  if (t === "fb" || t.includes("facebook") || t.includes("messenger")) return "facebook";
  if (t === "ig" || t.includes("instagram")) return "instagram";
  if (t.includes("whatsapp")) return "whatsapp";
  if (t === "gmb" || t.includes("google")) return "gmb";
  if (t.includes("live") || t.includes("webchat") || t.includes("chat")) return "live_chat";
  return null;
}

export function parseInboundMessage(payload: unknown): InboundMessage | null {
  const p = obj(payload);
  const message = obj(p.message);
  const contact = obj(p.contact);
  const custom = obj(p.customData);

  if (str(p.direction)?.toLowerCase() === "outbound") return null;
  const type = str(p.type);
  if (type && type !== "InboundMessage") return null;

  const body =
    str(p.body) ?? str(message.body) ?? str(p.message) ?? str(custom.message) ?? str(custom.body);
  if (!body) return null;

  const phone = str(p.phone) ?? str(contact.phone) ?? str(custom.phone);
  const email = str(p.email) ?? str(contact.email) ?? str(custom.email);

  const channel =
    normalizeChannel(str(custom.channel)) ??
    normalizeChannel(str(p.messageType)) ??
    normalizeChannel(str(message.type)) ??
    normalizeChannel(str(p.channel)) ??
    // Old setups only forwarded SMS replies, so a phone with no type is a text.
    (phone ? "sms" : email ? "email" : "other");

  const name =
    str(p.full_name) ??
    str(contact.name) ??
    ([str(p.first_name), str(p.last_name)].filter(Boolean).join(" ") || null);

  return {
    channel,
    body,
    contactId: str(p.contactId) ?? str(p.contact_id) ?? str(contact.id) ?? str(custom.contact_id),
    conversationId: str(p.conversationId) ?? str(message.conversationId) ?? null,
    messageId: str(p.messageId) ?? str(message.id) ?? null,
    phone,
    email,
    name,
    subject: str(p.subject) ?? str(message.subject) ?? str(custom.subject),
  };
}

export function parseInboundSms(payload: unknown): InboundSms | null {
  const parsed = parseInboundMessage(payload);
  if (!parsed) return null;
  return {
    contactId: parsed.contactId,
    phone: parsed.phone,
    body: parsed.body,
    messageId: parsed.messageId,
  };
}
