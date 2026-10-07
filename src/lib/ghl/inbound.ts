/**
 * Normalize an inbound-message webhook from GoHighLevel. Two shapes are
 * supported:
 *  - Workflow "Customer Replied" trigger -> Webhook action: standard contact
 *    fields (`contact_id`, `phone`, ...) plus `message: { body }`.
 *  - Marketplace/app `InboundMessage` event: `contactId`, `body`, `messageType`.
 */

export interface InboundSms {
  contactId: string | null;
  phone: string | null;
  body: string;
  messageId: string | null;
}

type Payload = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function obj(value: unknown): Payload {
  return value && typeof value === "object" ? (value as Payload) : {};
}

export function parseInboundSms(payload: unknown): InboundSms | null {
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

  return {
    body,
    contactId: str(p.contactId) ?? str(p.contact_id) ?? str(contact.id) ?? str(custom.contact_id),
    phone: str(p.phone) ?? str(contact.phone) ?? str(custom.phone),
    messageId: str(p.messageId) ?? str(message.id) ?? null,
  };
}
