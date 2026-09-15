import {
  afterCredit,
  estimateLawnSqft,
  money,
  priceAeration,
  pricingFrom,
  renderCampaign,
  sayLawn,
  type CampaignVars,
} from "@/lib/campaign";
import { dayOnly } from "@/lib/time-zone";
import type { Database } from "@/lib/supabase/database.types";

type CampaignRow = Database["public"]["Tables"]["email_campaigns"]["Row"];
type VariantRow = Database["public"]["Tables"]["email_campaign_variants"]["Row"];

export interface OrganizationForEmail {
  name: string;
  business_phone: string | null;
  business_address: string | null;
  business_email: string | null;
  public_base_url: string | null;
}

export interface ComposedCampaignEmail {
  subject: string;
  text: string;
  html: string;
  lawnSqft: number | null;
  priceCents: number | null;
}

/** "Friday, September 19" from "2026-09-19". */
export function sayExpiry(dateKey: string): string {
  return dayOnly(new Date(`${dateKey}T12:00:00-04:00`));
}

/**
 * One campaign email for one person, as text and as the same text in
 * HTML, with the footer the law requires: who sent it, where they are,
 * and how to stop. The price is worked out here from the property, and
 * comes back so the recipient row can remember what they were quoted.
 */
export function composeCampaignEmail(input: {
  campaign: Pick<CampaignRow, "offer_cents" | "code_expires_on" | "pricing" | "service_label">;
  variant: Pick<VariantRow, "subject" | "body" | "needs_price">;
  organization: OrganizationForEmail;
  recipient: { name: string | null; code: string; email: string };
  property: { address: string | null; acreage: number | null; sqft: number | null } | null;
  unsubscribeToken: string | null;
}): ComposedCampaignEmail {
  const pricing = pricingFrom(input.campaign.pricing);
  const lawnSqft = input.property ? estimateLawnSqft(input.property, pricing) : null;
  const price = lawnSqft != null ? priceAeration(pricing, lawnSqft) : null;
  const base = (input.organization.public_base_url ?? "").replace(/\/+$/, "");
  const first = (input.recipient.name ?? "").trim().split(/\s+/)[0] || "there";
  const contact = (input.organization.business_email ?? "").split("@")[0];

  const vars: CampaignVars = {
    first_name: first.charAt(0).toUpperCase() + first.slice(1),
    credit: money(input.campaign.offer_cents),
    expires: sayExpiry(input.campaign.code_expires_on),
    code: input.recipient.code,
    address: shortAddress(input.property?.address ?? null),
    lawn_size: sayLawn(lawnSqft),
    price: price ? money(price.totalCents) : "priced from your lot size",
    total: price ? money(afterCredit(price.totalCents, input.campaign.offer_cents)) : "priced from your lot size",
    offer_link: `${base}/offer/${input.recipient.code}`,
    business: input.organization.name,
    phone: input.organization.business_phone ?? "",
    signoff: contact ? contact.charAt(0).toUpperCase() + contact.slice(1) : input.organization.name,
  };

  const subject = renderCampaign(input.variant.subject, vars);
  const body = renderCampaign(input.variant.body, vars);
  const footer = [
    input.organization.name,
    input.organization.business_address ?? "",
    input.unsubscribeToken ? `Not want these emails? ${base}/u/${input.unsubscribeToken}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const text = `${body}\n\n\n${footer}`;

  return { subject, text, html: htmlFor(body, footer), lawnSqft, priceCents: price?.totalCents ?? null };
}

function shortAddress(address: string | null): string {
  if (!address) return "your property";
  return address.replace(/,\s*(Maryland|MD)\b.*$/, "");
}

/** The plain text as an email body. Deliberately plain: it should read as a person. */
function htmlFor(body: string, footer: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const paragraphs = body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 14px">${linked(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const foot = `<p style="margin:24px 0 0;font-size:12px;color:#666">${linked(footer).replace(/\n/g, "<br>")}</p>`;
  return `<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:640px">${paragraphs}${foot}</div>`;
}
