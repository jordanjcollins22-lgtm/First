"use server";

import { randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { propertyFor } from "@/lib/data/offer";
import { afterCredit, estimateLawnSqft, money, offerState, priceAeration, pricingFrom } from "@/lib/campaign";
import { dateKeyIn } from "@/lib/time-zone";
import { log } from "@/lib/log";

type Result = { ok: true; jobId: string; totalCents: number } | { ok: false; error: string };

const TIMINGS: Record<string, string> = {
  asap: "As soon as possible",
  two_weeks: "Within the next two weeks",
  month: "Any time this month",
};

/**
 * Booked, with the credit taken off.
 *
 * Makes the job and an accepted proposal for it in one go, priced from the
 * lot at this moment, so the office sees a sold job to schedule rather
 * than a lead to chase. The code is spent by it: a second press of the
 * button finds the booking already there.
 */
export async function bookOffer(input: { code: string; timing: string; notes: string }): Promise<Result> {
  if (!/^LAWN-[A-Z2-9]{4}$/.test(input.code)) return { ok: false, error: "That code is not right." };
  const admin = createAdminClient();

  const { data } = await admin
    .from("email_campaign_recipients")
    .select("id, name, customer_id, property_id, booked_at, booked_job_id, campaign:email_campaigns(id, status, offer_cents, code_expires_on, pricing, service_label, organization_id)")
    .eq("code", input.code)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    name: string | null;
    customer_id: string | null;
    property_id: string | null;
    booked_at: string | null;
    booked_job_id: string | null;
    campaign: { id: string; status: string; offer_cents: number; code_expires_on: string; pricing: unknown; service_label: string; organization_id: string } | null;
  } | null;
  if (!row?.campaign) return { ok: false, error: "That code is not right." };
  if (row.booked_at && row.booked_job_id) return { ok: true, jobId: row.booked_job_id, totalCents: 0 };

  const state = offerState({
    campaignStatus: row.campaign.status,
    expiresOn: row.campaign.code_expires_on,
    bookedAt: row.booked_at,
    today: dateKeyIn(new Date()),
  });
  if (!state.ok) {
    return { ok: false, error: state.reason === "expired" ? "That code has expired." : "That offer is no longer open." };
  }
  if (!row.property_id) return { ok: false, error: "We do not have an address for you. Reply to the email and we will book it by hand." };

  const property = await propertyFor(row.property_id);
  if (!property) return { ok: false, error: "We could not find that property. Reply to the email and we will book it by hand." };

  const pricing = pricingFrom(row.campaign.pricing);
  const lawnSqft = estimateLawnSqft(property, pricing);
  const price = lawnSqft != null ? priceAeration(pricing, lawnSqft) : null;
  // No lot size: booked at the minimum, and the job says the price is to be confirmed.
  const priceCents = price?.totalCents ?? pricing.minimumCents;
  const totalCents = afterCredit(priceCents, row.campaign.offer_cents);
  const timing = TIMINGS[input.timing] ?? TIMINGS.asap;
  const notes = input.notes.trim().slice(0, 1000);
  const now = new Date().toISOString();

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      property_id: property.id,
      name: `${property.address} — ${row.campaign.service_label}`,
      status: "approved",
      evaluation_status: "completed",
      client_notes: [
        `Booked from the email offer with code ${input.code}. ${money(row.campaign.offer_cents)} credit applied.`,
        lawnSqft != null ? `Lawn sized at about ${lawnSqft.toLocaleString("en-US")} sq ft from the lot.` : "Lot size unknown: booked at the minimum, price to confirm.",
        `Timing: ${timing}.`,
        notes ? `Client notes: ${notes}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    })
    .select("id")
    .single();
  if (jobError || !job) {
    log.error("offer.book_failed", jobError, { recipientId: row.id });
    return { ok: false, error: "Could not book that just now. Reply to the email and we will do it by hand." };
  }

  const { error: proposalError } = await admin.from("job_proposals").insert({
    job_id: job.id,
    organization_id: row.campaign.organization_id,
    token: randomBytes(16).toString("hex"),
    status: "accepted",
    total_cost: totalCents / 100,
    scope_snapshot: [
      {
        zoneName: "Lawn",
        serviceLabel: row.campaign.service_label,
        scopeText: [
          `Core aeration and overseeding of ${lawnSqft != null ? `about ${lawnSqft.toLocaleString("en-US")} sq ft of` : "the"} lawn.`,
          price ? `Seed ${money(price.seedCents)}, crew time ${money(price.laborCents)}, aerator ${money(price.aeratorCents)}.` : "Priced at the minimum, to confirm on site.",
          price?.minimumApplied ? `Minimum visit ${money(pricing.minimumCents)} applied.` : "",
          `${money(row.campaign.offer_cents)} account credit applied with code ${input.code}.`,
        ]
          .filter(Boolean)
          .join(" "),
        photoPaths: [],
        points: [],
        color: "#2f6d3c",
        priceCents: totalCents,
      },
    ],
    generated_at: now,
    approved_at: now,
    responded_at: now,
  });
  if (proposalError) {
    log.error("offer.proposal_failed", proposalError, { recipientId: row.id, jobId: job.id });
  }

  await admin
    .from("email_campaign_recipients")
    .update({ booked_at: now, booked_job_id: job.id, lawn_sqft: lawnSqft, price_cents: priceCents })
    .eq("id", row.id);

  log.info("offer.booked", { recipientId: row.id, jobId: job.id, lawnSqft, priceCents, totalCents, timing: input.timing });
  return { ok: true, jobId: job.id, totalCents };
}
