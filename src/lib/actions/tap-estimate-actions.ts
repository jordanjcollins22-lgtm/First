"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAnswers } from "@/lib/evaluation-intake";
import { instantPrice } from "@/lib/instant-price";
import { estimateCatalogFor } from "@/lib/data/estimate-catalog";
import { lotForProperty } from "@/lib/data/lot-map";
import { estimatePath, schedulePath, tiersForOrganization } from "@/lib/data/tap-estimate";
import { DEPOSIT_TIER, isTierId, tierById, type TierId } from "@/lib/evaluation-tiers";
import { answersFromSpots, areaForPoint, depositCents, dollars, parseTapSpots, regionsFor } from "@/lib/tap-estimate";
import { isStripeConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute } from "@/lib/proposal-flow";
import { getJobCustomerContact } from "@/lib/job-customer";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";
import { surchargeCents, SURCHARGE_LABEL } from "@/lib/card-surcharge";
import { notifyJobTeam } from "@/lib/notifications";
import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/database.types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const TOKEN = /^[0-9a-f]{24}$/;
const LINK_GONE = "That link has expired or was never ours. Give us a call.";

/** The form behind a token, with what the estimate needs: the job, its business and the house. */
async function formFor(token: string) {
  if (!TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("evaluation_intakes")
    .select("id, job_id, organization_id, answers, job:jobs(cancelled_at, evaluation_status, property:properties(id, lat, lng))")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  const job = data.job as unknown as {
    cancelled_at: string | null;
    evaluation_status: string;
    property: { id: string; lat: number | null; lng: number | null } | null;
  } | null;
  return {
    admin,
    id: data.id,
    jobId: data.job_id,
    organizationId: data.organization_id,
    answers: cleanAnswers(data.answers),
    cancelled: Boolean(job?.cancelled_at) || job?.evaluation_status === "cancelled",
    property: job?.property ?? null,
  };
}

/**
 * The map, sent: the spots fill in the pre-evaluation answers (so the
 * evaluator's site map is set up from them like any other form), and the
 * estimate is worked from those answers and kept. Sending again replaces
 * both, until the deposit is under way; after that the estimate is held.
 */
export async function submitTapPreEval(input: { token: string; spots: unknown }): Promise<Result> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: LINK_GONE };
  if (form.cancelled) return { ok: false, error: "This visit was cancelled. Give us a call to book again." };
  if (!form.property || form.property.lat == null || form.property.lng == null) {
    return { ok: false, error: "We couldn't find your property on the map. Give us a call." };
  }

  const spots = parseTapSpots(input.spots, { jobId: form.jobId, home: [form.property.lng, form.property.lat] });
  if (!spots) return { ok: false, error: "Something about those spots didn't look right. Try again." };
  // Photos were saved to the form as they were added, so any other path is not theirs.
  if (spots.some((s) => s.photos.some((p) => !form.answers.photos.includes(p)))) {
    return { ok: false, error: "One of those photos didn't finish uploading. Remove it and add it again." };
  }

  const { data: existing } = await form.admin.from("job_estimates").select("id, paid_at").eq("job_id", form.jobId).maybeSingle();
  if (existing?.paid_at) return { ok: false, error: "You've already paid on this estimate. Message us to change anything." };

  const lot = await lotForProperty(form.property.id);
  const regions = regionsFor(lot);
  const answers = {
    ...answersFromSpots(form.answers, spots, (s) => areaForPoint([s.lng, s.lat], regions)),
    // Saved as they were added, never taken from what was sent.
    photos: form.answers.photos,
    photo_areas: form.answers.photo_areas,
  };

  const now = new Date().toISOString();
  const { error: intakeError } = await form.admin
    .from("evaluation_intakes")
    .update({ answers: answers as unknown as Json, submitted_at: now, submitted_by: "client", updated_at: now })
    .eq("id", form.id);
  if (intakeError) return { ok: false, error: "Could not save that. Try again in a moment." };

  const catalog = await estimateCatalogFor(form.admin, form.organizationId);
  const price = instantPrice(answers, lot, catalog);
  const row = {
    organization_id: form.organizationId,
    job_id: form.jobId,
    spots: spots as unknown as Json,
    price: price as unknown as Json,
    total_cents: price.totalCents,
    deposit_cents: depositCents(price.totalCents),
    updated_at: now,
  };
  const { error } = await form.admin.from("job_estimates").upsert(row, { onConflict: "job_id" });
  if (error) {
    log.error("estimate.save_failed", { jobId: form.jobId, error: error.message });
    return { ok: false, error: "Could not work out your estimate. Try again in a moment." };
  }

  log.info("estimate.sent", { jobId: form.jobId, spots: spots.length, totalCents: price.totalCents });
  notifyJobTeam(
    form.jobId,
    "proposal_responses",
    `A client marked ${spots.length} ${spots.length === 1 ? "spot" : "spots"} on their map pre-evaluation. Estimate ${dollars(price.totalCents)}.`,
    { dedupeKey: `estimate-${form.jobId}-${now}` }
  ).catch(() => {});
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true };
}

/**
 * Paying, one of two ways, either of which comes before anybody drives out:
 *
 * - "deposit": a third of the estimate, which holds the job and comes with
 *   the basic evaluation visit;
 * - a tier id: a paid evaluation, for somebody not ready to commit.
 *
 * Both are recorded against the job when Stripe says they landed, so the
 * proposal after the visit asks only for the rest: the evaluation fee comes
 * off the job like the deposit does. Afterwards they pick the visit time.
 */
export async function startEstimatePayment(input: { token: string; pay: string }): Promise<Result<{ url: string }>> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: LINK_GONE };
  if (form.cancelled) return { ok: false, error: "This visit was cancelled. Give us a call to book again." };
  if (!isStripeConfigured) return { ok: false, error: "Card payments aren't switched on yet. Give us a call." };

  const { data: estimate } = await form.admin
    .from("job_estimates")
    .select("id, deposit_cents, paid_at")
    .eq("job_id", form.jobId)
    .maybeSingle();
  if (!estimate) return { ok: false, error: "Send your map first, then your estimate shows here." };
  if (estimate.paid_at) return { ok: false, error: "You've already paid. Thank you!" };

  let choice: "deposit" | "evaluation";
  let tierId: TierId;
  let amountCents: number;
  let description: string;
  if (input.pay === "deposit") {
    if (!(estimate.deposit_cents > 0)) return { ok: false, error: "We need to see this one before we can price it. Book an evaluation instead." };
    choice = "deposit";
    tierId = DEPOSIT_TIER;
    amountCents = estimate.deposit_cents;
    description = "Deposit, one third of your estimate";
  } else {
    // Prices come from the business's settings, never from the page.
    const tier = isTierId(input.pay) ? tierById(await tiersForOrganization(form.organizationId), input.pay) : null;
    if (!tier) return { ok: false, error: "Pick one of the evaluations." };
    choice = "evaluation";
    tierId = tier.id;
    amountCents = tier.priceCents;
    description = `${tier.name} (comes off your project if you go ahead)`;
  }

  const baseUrl = await outboundBaseUrl();
  const contact = await getJobCustomerContact(form.jobId);
  if (!baseUrl || !contact) return { ok: false, error: "Couldn't open the payment page. Give us a call." };
  const existing = contact.customerId ? await stripeCustomerFor(contact.customerId) : null;
  const fee = surchargeCents(amountCents);

  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: "payment",
      ...(existing ? { customer: existing } : { customer_email: contact.email || undefined, customer_creation: "always" as const }),
      line_items: [
        { price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: description } }, quantity: 1 },
        ...(fee > 0
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: fee,
                  product_data: { name: SURCHARGE_LABEL, description: "What the card processor charges to take a card payment." },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      // Straight on to picking the visit time.
      success_url: `${absolute(baseUrl, schedulePath(input.token))}?paid=1`,
      cancel_url: absolute(baseUrl, estimatePath(input.token)),
      metadata: {
        organization_id: form.organizationId,
        // On the job, so it counts towards what the proposal after the visit asks for.
        job_id: form.jobId,
        estimate_id: estimate.id,
        // What this checkout is for, so the webhook records what was paid
        // even if they started another one meanwhile.
        estimate_choice: choice,
        estimate_tier: tierId,
        work_cents: String(amountCents),
        surcharge_cents: String(fee),
      },
    });
    if (!session.url) throw new Error("Stripe returned no checkout link.");

    const now = new Date().toISOString();
    await form.admin
      .from("job_estimates")
      .update({ accepted_at: now, choice, evaluation_tier: tierId, charged_cents: amountCents, checkout_session_id: session.id, updated_at: now })
      .eq("id", estimate.id);
    notifyJobTeam(
      form.jobId,
      "proposal_responses",
      choice === "deposit"
        ? `A client accepted their estimate and is paying the ${dollars(amountCents)} deposit.`
        : `A client is booking a paid evaluation (${description.split(" (")[0]}, ${dollars(amountCents)}).`,
      { dedupeKey: `estimate-pay-${estimate.id}-${choice}-${tierId}` }
    ).catch(() => {});
    return { ok: true, url: session.url };
  } catch (err) {
    log.error("estimate.checkout_failed", { jobId: form.jobId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Couldn't open the payment page. Try again, or give us a call." };
  }
}

/** A question about the estimate, on the job's thread with the client, and to the team. */
export async function askEstimateQuestion(input: { token: string; body: string }): Promise<Result> {
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { ok: false, error: "Write your question first." };
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: LINK_GONE };

  const contact = await getJobCustomerContact(form.jobId).catch(() => null);
  const { error } = await form.admin.from("job_messages").insert({
    job_id: form.jobId,
    organization_id: form.organizationId,
    channel: "external",
    author_type: "client",
    author_name: contact?.customerName?.trim() || "Client",
    body,
    reference_label: "Their estimate",
    reference_kind: "proposal",
  });
  if (error) return { ok: false, error: "Couldn't send that. Try again in a moment." };

  notifyJobTeam(form.jobId, "client_messages", `A client asked about their estimate: "${body.slice(0, 280)}"`).catch(() => {});
  revalidatePath(`/jobs/${form.jobId}`);
  revalidatePath(`/conversations/job/${form.jobId}`);
  return { ok: true };
}
