import { createAdminClient } from "@/lib/supabase/admin";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { afterCredit, estimateLawnSqft, offerState, priceAeration, pricingFrom, type AerationPrice } from "@/lib/campaign";
import { dateKeyIn } from "@/lib/time-zone";
import { log } from "@/lib/log";

/** What the offer page shows the person who opened their link. */
export interface OfferView {
  code: string;
  firstName: string | null;
  campaignName: string;
  serviceLabel: string;
  creditCents: number;
  expiresOn: string;
  state: ReturnType<typeof offerState>;
  address: string | null;
  lawnSqft: number | null;
  price: AerationPrice | null;
  totalCents: number | null;
  minimumCents: number;
  bookedJobId: string | null;
  business: { name: string; phone: string | null };
}

/**
 * The offer behind a code, for somebody with no account.
 *
 * Opening the link is the click, so it is written down. If the property has
 * no lot size yet, one lookup is made now and saved on the property, so the
 * price is real rather than a guess and the next open costs nothing.
 */
export async function getOfferByCode(code: string): Promise<OfferView | null> {
  if (!/^LAWN-[A-Z2-9]{4}$/.test(code)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_campaign_recipients")
    .select(
      "id, code, name, clicked_at, booked_at, booked_job_id, property_id, campaign:email_campaigns(name, status, offer_cents, code_expires_on, pricing, service_label, organization_id)"
    )
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    code: string;
    name: string | null;
    clicked_at: string | null;
    booked_at: string | null;
    booked_job_id: string | null;
    property_id: string | null;
    campaign: {
      name: string;
      status: string;
      offer_cents: number;
      code_expires_on: string;
      pricing: unknown;
      service_label: string;
      organization_id: string;
    } | null;
  };
  if (!row.campaign) return null;

  if (!row.clicked_at) {
    await admin.from("email_campaign_recipients").update({ clicked_at: new Date().toISOString() }).eq("id", row.id);
    log.info("campaign.clicked", { recipientId: row.id });
  }

  const [{ data: org }, property] = await Promise.all([
    admin.from("organizations").select("name, business_phone").eq("id", row.campaign.organization_id).single(),
    propertyFor(row.property_id),
  ]);

  const pricing = pricingFrom(row.campaign.pricing);
  const lawnSqft = property ? estimateLawnSqft(property, pricing) : null;
  const price = lawnSqft != null ? priceAeration(pricing, lawnSqft) : null;

  return {
    code: row.code,
    firstName: (row.name ?? "").trim().split(/\s+/)[0] || null,
    campaignName: row.campaign.name,
    serviceLabel: row.campaign.service_label,
    creditCents: row.campaign.offer_cents,
    expiresOn: row.campaign.code_expires_on,
    state: offerState({
      campaignStatus: row.campaign.status,
      expiresOn: row.campaign.code_expires_on,
      bookedAt: row.booked_at,
      today: dateKeyIn(new Date()),
    }),
    address: property?.address ?? null,
    lawnSqft,
    price,
    totalCents: price ? afterCredit(price.totalCents, row.campaign.offer_cents) : null,
    minimumCents: pricing.minimumCents,
    bookedJobId: row.booked_job_id,
    business: { name: org?.name ?? "", phone: org?.business_phone ?? null },
  };
}

/** The property with a lot size, looked up and saved if it has none yet. */
export async function propertyFor(propertyId: string | null): Promise<{ id: string; address: string; acreage: number | null; sqft: number | null } | null> {
  if (!propertyId) return null;
  const admin = createAdminClient();
  const { data: property } = await admin.from("properties").select("id, address, acreage, sqft").eq("id", propertyId).maybeSingle();
  if (!property) return null;
  if (property.acreage != null) return property;

  const details = await lookupPropertyDetails(property.address).catch(() => null);
  if (!details) return property;
  await admin.from("properties").update({ sqft: details.sqft ?? property.sqft, acreage: details.acreage }).eq("id", property.id);
  return { ...property, sqft: details.sqft ?? property.sqft, acreage: details.acreage };
}
