import { createHash } from "node:crypto";

/**
 * Telling Meta which ad clicks became real buyers, through its Conversions
 * API, from our server. Only people who passed the area check and gave their
 * details (a Lead), or paid (a Purchase), are ever sent: everybody else stays
 * between us and them, so the ads learn from buyers and nobody else.
 *
 * Email and phone are sent hashed, the way Meta asks: trimmed, lowercased,
 * SHA-256. Pure apart from the hash, so the payload is tested without Meta.
 */

export const META_API_VERSION = "v21.0";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashEmail(email: string): string | null {
  const v = email.trim().toLowerCase();
  return v.includes("@") ? sha256(v) : null;
}

/** US numbers with the country code and nothing else: "14105550100". */
export function hashPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return digits.length >= 11 ? sha256(digits) : null;
}

/** The click id as Meta's own pixel would have stored it, from ?fbclid= on the ad link. */
export function fbcFromClickId(fbclid: string | null | undefined, at: Date): string | null {
  if (!fbclid || !/^[\w-]{10,500}$/.test(fbclid)) return null;
  return `fb.1.${at.getTime()}.${fbclid}`;
}

export interface MetaEventInput {
  name: "Lead" | "Purchase";
  /** The same id for the same event, so Meta never counts one twice. */
  eventId: string;
  at: Date;
  sourceUrl: string;
  email: string;
  phone: string;
  zip?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  valueCents?: number | null;
}

export function metaEvent(input: MetaEventInput) {
  const em = hashEmail(input.email);
  const ph = hashPhone(input.phone);
  const zp = input.zip && /^\d{5}$/.test(input.zip) ? sha256(input.zip) : null;
  return {
    event_name: input.name,
    event_time: Math.floor(input.at.getTime() / 1000),
    event_id: input.eventId,
    action_source: "website",
    event_source_url: input.sourceUrl,
    user_data: {
      ...(em ? { em: [em] } : {}),
      ...(ph ? { ph: [ph] } : {}),
      ...(zp ? { zp: [zp] } : {}),
      country: [sha256("us")],
      ...(input.fbc ? { fbc: input.fbc } : {}),
      ...(input.fbp ? { fbp: input.fbp } : {}),
      ...(input.ip ? { client_ip_address: input.ip } : {}),
      ...(input.userAgent ? { client_user_agent: input.userAgent } : {}),
    },
    ...(input.name === "Purchase" && input.valueCents != null ? { custom_data: { currency: "USD", value: Math.round(input.valueCents) / 100 } } : {}),
  };
}

/** Where the event goes. Null when the pixel or token isn't set, which is how it stays off. */
export function metaEndpoint(pixelId: string | undefined, token: string | undefined): string | null {
  if (!pixelId || !/^\d{5,25}$/.test(pixelId) || !token) return null;
  return `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
}
