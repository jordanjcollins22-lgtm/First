"use server";

import { headers } from "next/headers";
import { classifyAgent } from "@/lib/click-agent";
import { isVariant, type AddressEntry, type AddressVariant, type LocateResult } from "@/lib/booking-test";
import { bookingPageKey, claimBooking, releaseClaim, settleClaim } from "@/lib/data/booking-claims";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusyBlocksAsAdmin } from "@/lib/data/busy";
import { freeOf } from "@/lib/busy";
import { tooSoon } from "@/lib/booking-notice";
import { zonedToUtc } from "@/lib/time-zone";
import { log } from "@/lib/log";
import { getBookingNotice } from "@/lib/data/public-booking";
import { SLOT_MINUTES } from "@/lib/booking-availability";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";
import { modeForAddress } from "@/lib/evaluation-mode";
import { syncEvaluationToGhl } from "@/lib/ghl/sync";
import { sendEvaluationConfirmationNow } from "@/lib/data/booking-notices";
import { chooseEvaluator, type EvaluatorDay } from "@/lib/evaluator-choice";
import { ensureClientAccount } from "@/lib/data/client-accounts";
import { bookingSource, cleanAdClick, type AdClick } from "@/lib/ad-click";
import { recordBookingAdClick } from "@/lib/data/meta-report";

/** Who they are and where, from the booking page. The visit time comes later, once they've paid. */
export interface StartPublicLeadInput {
  organizationId: string;
  referredByProfileId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  requestedServiceTypeIds: string[];
  notes: string;
  /** The code off a posted recommendation link, if this came through one. */
  referralCode?: string | null;
  /** The address test: which side this browser was on, how the address went in, and the visit it came from. */
  bookingVariant?: AddressVariant | null;
  addressEntry?: AddressEntry | null;
  visitId?: string | null;
  /** The ad they tapped to get here, read off the page's address in their browser. */
  adClick?: AdClick | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One open of the booking page, with the side of the address test it was
 * shown. Recorded from the browser once the form is up, so a prerendered
 * page still counts. Bots are kept but marked, and left out of the maths.
 */
export async function recordBookingVisit(input: {
  organizationId: string;
  variant: AddressVariant;
  referralCode?: string | null;
  linkRef?: string | null;
}): Promise<{ visitId: string | null }> {
  try {
    if (!isVariant(input.variant) || !UUID_RE.test(input.organizationId)) return { visitId: null };
    const admin = createAdminClient();
    const agent = classifyAgent((await headers()).get("user-agent"));
    const { data } = await admin
      .from("booking_visits")
      .insert({
        organization_id: input.organizationId,
        variant: input.variant,
        referral_code: input.referralCode?.trim().slice(0, 40) || null,
        link_ref: input.linkRef?.trim().slice(0, 80) || null,
        agent,
      })
      .select("id")
      .single();
    return { visitId: data?.id ?? null };
  } catch (err) {
    console.error("recordBookingVisit failed:", err);
    return { visitId: null };
  }
}

/** What happened when they tapped "Use my location". */
export async function recordLocateResult(input: { visitId: string; result: LocateResult | "tapped" }): Promise<void> {
  try {
    if (!UUID_RE.test(input.visitId)) return;
    const admin = createAdminClient();
    const patch = input.result === "tapped" ? { located_tapped: true } : { located_tapped: true, located_result: input.result };
    await admin.from("booking_visits").update(patch).eq("id", input.visitId);
  } catch (err) {
    console.error("recordLocateResult failed:", err);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The first half of booking, now that the time comes last: who they are and
 * where, saved as a lead (a job with no visit yet) with its pre-evaluation
 * form ready. They go straight on to mark the map and see their estimate,
 * and pick a visit time only once they have paid.
 */
export async function startPublicLead(input: StartPublicLeadInput): Promise<{ jobId: string; prepToken: string }> {
  const email = input.email.trim().toLowerCase();
  const admin = createAdminClient();
  // The same person sending the same details twice at once (a double tap, a
  // slow phone) gets the one lead, not two.
  const key = EMAIL_RE.test(email) ? bookingPageKey(input.organizationId, email, `lead:${input.address.trim().toLowerCase()}`) : null;
  if (key) {
    const claim = await claimBooking(admin, key);
    if (!claim.won) {
      if (!claim.jobId) throw new Error("That's still going through. Give it a moment, then try again.");
      const { data: intake } = await admin.from("evaluation_intakes").select("token").eq("job_id", claim.jobId).maybeSingle();
      if (intake?.token) return { jobId: claim.jobId, prepToken: intake.token };
    }
  }
  try {
    const made = await makePublicLead(input);
    if (key) await settleClaim(admin, key, made.jobId);
    return made;
  } catch (err) {
    if (key) await releaseClaim(admin, key).catch(() => undefined);
    throw err;
  }
}

async function makePublicLead(input: StartPublicLeadInput): Promise<{ jobId: string; prepToken: string }> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const address = input.address.trim();

  if (!firstName || !lastName) throw new Error("Enter your first and last name.");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
  if (!phone) throw new Error("Enter a phone number.");
  if (!address || typeof input.lat !== "number" || typeof input.lng !== "number") {
    throw new Error("Select your address from the search results.");
  }

  const admin = createAdminClient();
  const adClick = cleanAdClick(input.adClick);
  const { data: org, error: orgError } = await admin.from("organizations").select("id").eq("id", input.organizationId).maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error("This booking link isn't valid anymore.");

  const { data: activeServices, error: servicesError } = await admin
    .from("services")
    .select("service_type_id")
    .eq("organization_id", input.organizationId)
    .eq("status", "active");
  if (servicesError) throw servicesError;
  const validServiceIds = new Set((activeServices ?? []).map((s) => s.service_type_id));
  const requestedServiceIds = input.requestedServiceTypeIds.filter((id) => validServiceIds.has(id));

  const referralCode = await knownReferralCode(admin, input.organizationId, input.referralCode);
  const { customerId, propertyId } = await customerAndProperty(admin, {
    organizationId: input.organizationId,
    firstName,
    lastName,
    email,
    phone,
    address,
    lat: input.lat,
    lng: input.lng,
    source: bookingSource(adClick, referralCode),
  });
  const mode = modeForAddress(input.lat, input.lng, address);

  // No evaluation_date, no evaluator: that is set when they pick a time.
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: `${address}, Estimate`,
      evaluation_mode: mode.mode,
      referral_code: referralCode,
      booking_variant: isVariant(input.bookingVariant) ? input.bookingVariant : null,
      address_entry: input.addressEntry === "located" || input.addressEntry === "typed" ? input.addressEntry : null,
      client_notes: input.notes.trim() || null,
      referred_by_profile_id: input.referredByProfileId,
    })
    .select()
    .single();
  if (jobError) throw jobError;

  // The form is normally made by a trigger when a job gets a date. This job
  // has none yet, and the form is the very next page, so it is made here.
  const { data: intake, error: intakeError } = await admin
    .from("evaluation_intakes")
    .upsert({ organization_id: input.organizationId, job_id: job.id }, { onConflict: "job_id" })
    .select("token")
    .single();
  if (intakeError) throw intakeError;

  if (input.visitId && UUID_RE.test(input.visitId)) {
    await admin
      .from("booking_visits")
      .update({ booked_job_id: job.id, booked_at: new Date().toISOString() })
      .eq("id", input.visitId)
      .is("booked_job_id", null);
  }
  if (requestedServiceIds.length > 0) {
    const { error: requestedError } = await admin.from("job_requested_services").insert(
      requestedServiceIds.map((serviceTypeId) => ({ job_id: job.id, organization_id: input.organizationId, service_type_id: serviceTypeId }))
    );
    if (requestedError) throw requestedError;
  }

  const who = await requestHeaders();
  await recordBookingAdClick(admin, {
    jobId: job.id,
    organizationId: input.organizationId,
    click: adClick,
    email,
    phone,
    ip: who.ip,
    userAgent: who.userAgent,
  }).catch((err) => log.warn("lead.meta_failed", { jobId: job.id, error: err instanceof Error ? err.message : String(err) }));
  await reconcileProspects(admin).catch(() => null);
  await ensureClientAccount({ customerId, email }).catch(() => null);

  log.info("lead.created", { jobId: job.id, customerId, mode: mode.mode, referralCode, services: requestedServiceIds.length });
  return { jobId: job.id, prepToken: intake.token };
}

/**
 * The visit, booked once they have paid: a deposit (which comes with the
 * basic evaluation) or a paid evaluation. The same checks as a booking made
 * the old way, at the moment it is made: the business's notice, and that
 * the evaluator is still free.
 */
export async function bookPaidEvaluationVisit(input: {
  token: string;
  date: string;
  time: string;
  candidateEvaluatorIds: string[];
}): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{24}$/.test(input.token)) return { ok: false, error: "That link has expired or was never ours. Give us a call." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return { ok: false, error: "Pick a time first." };
  if (input.candidateEvaluatorIds.length === 0) return { ok: false, error: "That time is no longer available, please pick another." };

  const admin = createAdminClient();
  const { data: intake } = await admin
    .from("evaluation_intakes")
    .select("job_id, organization_id, job:jobs(evaluation_date, property:properties(address, lat, lng))")
    .eq("token", input.token)
    .maybeSingle();
  if (!intake) return { ok: false, error: "That link has expired or was never ours. Give us a call." };
  const job = intake.job as unknown as { evaluation_date: string | null; property: { address: string; lat: number; lng: number } | null } | null;
  // Already booked: picking again is a reschedule, which goes through us.
  if (job?.evaluation_date) return { ok: true, at: job.evaluation_date };
  if (!job?.property) return { ok: false, error: "We couldn't find your property. Give us a call." };

  const { data: estimate } = await admin.from("job_estimates").select("paid_at").eq("job_id", intake.job_id).maybeSingle();
  if (!estimate?.paid_at) return { ok: false, error: "Your payment hasn't come through yet. Give it a minute and try again." };

  const notice = await getBookingNotice(intake.organization_id);
  const at = zonedToUtc(input.date, input.time, notice.timeZone);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Pick a time first." };
  const soon = tooSoon(notice, new Date(), { date: input.date, at });
  if (soon) return { ok: false, error: soon };

  const end = new Date(at.getTime() + SLOT_MINUTES * 60_000);
  const blocks = await getBusyBlocksAsAdmin().catch(() => []);
  const stillFree = freeOf(blocks, input.candidateEvaluatorIds, { start: at, end });
  if (stillFree.length === 0) return { ok: false, error: "That time was just booked, please pick another." };
  const choice = chooseEvaluator(stillFree, await daysFor(admin, stillFree, input.date), { lat: job.property.lat, lng: job.property.lng });
  if (!choice) return { ok: false, error: "That time was just booked, please pick another." };

  const { error } = await admin
    .from("jobs")
    .update({ evaluation_date: at.toISOString(), assigned_to: choice.evaluatorId, evaluation_status: "scheduled" })
    .eq("id", intake.job_id)
    .is("evaluation_date", null);
  if (error) return { ok: false, error: "Couldn't book that time. Try again in a moment." };

  await syncEvaluationToGhl(intake.job_id);
  await sendEvaluationConfirmationNow(intake.job_id);
  log.info("lead.visit_booked", { jobId: intake.job_id, evaluatorId: choice.evaluatorId, at: at.toISOString() });
  return { ok: true, at: at.toISOString() };
}

/**
 * The client and the property a booking is for: the ones we already have
 * when they match (by email, phone or name, and by address), new ones when
 * they don't. Shared by the booking and by the lead that starts the map
 * pre-evaluation, so both land on the same records.
 */
async function customerAndProperty(
  admin: ReturnType<typeof createAdminClient>,
  input: { organizationId: string; firstName: string; lastName: string; email: string; phone: string; address: string; lat: number; lng: number; source: string | null }
): Promise<{ customerId: string; propertyId: string }> {
  const { firstName, lastName, email, phone, address } = input;
  const { data: existingCustomers, error: existingCustomerError } = await admin
    .from("customers")
    .select("id, name, email, phone")
    .eq("organization_id", input.organizationId);
  if (existingCustomerError) throw existingCustomerError;

  // Same matcher the office uses, so a booking lands on the existing client
  // record whether we know them by email, phone, or name.
  const duplicateCustomer = findDuplicateCustomer(existingCustomers ?? [], {
    name: `${firstName} ${lastName}`,
    email,
    phone,
  });

  let customerId: string;
  if (duplicateCustomer) {
    customerId = duplicateCustomer.id;
    // Fills blanks only. A booking form shouldn't overwrite a phone number or
    // spelling the office already corrected by hand.
    const patch = mergeableFields(
      {
        name: duplicateCustomer.name ?? null,
        email: duplicateCustomer.email ?? null,
        phone: duplicateCustomer.phone ?? null,
      },
      { name: `${firstName} ${lastName}`, email, phone }
    );
    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await admin.from("customers").update(patch).eq("id", customerId);
      if (updateError) throw updateError;
    }
  } else {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        name: `${firstName} ${lastName}`,
        email,
        phone,
        organization_id: input.organizationId,
        source: input.source,
      })
      .select()
      .single();
    if (customerError) throw customerError;
    customerId = customer.id;
  }

  const { data: existingProperties, error: existingPropertyError } = await admin
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);
  if (existingPropertyError) throw existingPropertyError;

  const duplicateProperty = findDuplicateProperty(existingProperties ?? [], address);

  let propertyId: string;
  if (duplicateProperty) {
    propertyId = duplicateProperty.id;
  } else {
    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({ customer_id: customerId, address, lat: input.lat, lng: input.lng })
      .select()
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const details = await lookupPropertyDetails(address).catch(() => null);
    if (details) {
      await admin.from("properties").update({ sqft: details.sqft, acreage: details.acreage }).eq("id", propertyId);
    }
  }

  return { customerId, propertyId };
}

/**
 * What each candidate's day already looks like, so the choice is informed.
 *
 * One read for the lot rather than one per person. Coordinates come along
 * because "is anybody already going that way" is the first question, and they
 * never leave the server — the client is told who is coming, not where
 * anybody else lives.
 */
async function daysFor(
  admin: ReturnType<typeof createAdminClient>,
  evaluatorIds: string[],
  date: string
): Promise<EvaluatorDay[]> {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const { data: rows } = await admin
    .from("jobs")
    .select("assigned_to, evaluation_date, properties(lat, lng)")
    .in("assigned_to", evaluatorIds)
    .gte("evaluation_date", dayStart.toISOString())
    .lt("evaluation_date", dayEnd.toISOString());

  const visits = new Map<string, { lat: number | null; lng: number | null }[]>();
  for (const raw of rows ?? []) {
    const row = raw as unknown as {
      assigned_to: string | null;
      properties: { lat: number | null; lng: number | null } | null;
    };
    if (!row.assigned_to) continue;
    const list = visits.get(row.assigned_to) ?? [];
    list.push({ lat: row.properties?.lat ?? null, lng: row.properties?.lng ?? null });
    visits.set(row.assigned_to, list);
  }

  // When nobody is nearby and the days are equally light, it goes to whoever
  // has waited longest, so it rotates instead of settling on one name.
  const { data: latest } = await admin
    .from("jobs")
    .select("assigned_to, created_at")
    .in("assigned_to", evaluatorIds)
    .not("evaluation_date", "is", null)
    .order("created_at", { ascending: false });

  const lastBooked = new Map<string, string>();
  for (const row of (latest ?? []) as { assigned_to: string | null; created_at: string }[]) {
    if (row.assigned_to && !lastBooked.has(row.assigned_to)) {
      lastBooked.set(row.assigned_to, row.created_at);
    }
  }

  return evaluatorIds.map((id) => ({
    evaluatorId: id,
    visits: visits.get(id) ?? [],
    lastBookedAt: lastBooked.get(id) ?? null,
  }));
}

/**
 * The recommendation code off the link, if it is one of ours.
 *
 * Checked rather than trusted. A code nobody issued, stored on a job, becomes
 * a booking credited to a group nobody ever posted in — which is worse than
 * no attribution at all, because somebody would act on it.
 */
async function knownReferralCode(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  code: string | null | undefined
): Promise<string | null> {
  const wanted = (code ?? "").trim().toLowerCase();
  if (!wanted || wanted.length > 32) return null;
  const { data } = await admin
    .from("outreach_links")
    .select("code")
    .eq("organization_id", organizationId)
    .eq("code", wanted)
    .maybeSingle();
  return data?.code ?? null;
}

/** The visitor's address and browser, sent with the Meta event so it can match them. */
async function requestHeaders(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return { ip: list.get("x-forwarded-for")?.split(",")[0]?.trim() || null, userAgent: list.get("user-agent")?.slice(0, 400) || null };
  } catch {
    return { ip: null, userAgent: null };
  }
}
