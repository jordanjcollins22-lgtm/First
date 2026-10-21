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
import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";
import { findDuplicateCustomer, findDuplicateProperty, mergeableFields } from "@/lib/dedupe";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";
import { modeForAddress, type EvaluationMode } from "@/lib/evaluation-mode";
import { syncEvaluationToGhl } from "@/lib/ghl/sync";
import { chooseEvaluator, type EvaluatorDay } from "@/lib/evaluator-choice";
import { loadTerritories } from "@/lib/data/territories";
import { zipOf } from "@/lib/material-suppliers";
import { ensureClientAccount } from "@/lib/data/client-accounts";
import { bookingSource, cleanAdClick, type AdClick } from "@/lib/ad-click";
import { recordBookingAdClick } from "@/lib/data/meta-report";
import { cleanHeardAbout } from "@/lib/heard-about";
import { routeForBudget } from "@/lib/photo-quote";
import { readPhotoQuotes, waitingPhotoQuoteJob } from "@/lib/data/photo-quotes";
import { sendEvaluationConfirmationNow, sendPhotoQuoteLinkNow } from "@/lib/data/booking-notices";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordBooking } from "@/lib/os/app-events";

// The photo-quote columns are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export interface SubmitPublicBookingInput {
  organizationId: string;
  referredByProfileId: string | null;
  /** Every evaluator who was free at this slot when the client picked it — the
   * server re-checks each in order and books the first still free. */
  candidateEvaluatorIds: string[];
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  requestedServiceTypeIds: string[];
  notes: string;
  budgetRange: string;
  /** The code off a posted recommendation link, if this came through one. */
  referralCode?: string | null;
  /** The address test: which side this browser was on, how the address went in, and the visit it came from. */
  bookingVariant?: AddressVariant | null;
  addressEntry?: AddressEntry | null;
  visitId?: string | null;
  /** The ad they tapped to get here, read off the page's address in their browser. */
  adClick?: AdClick | null;
  /** Their answer to "How did you hear about us?", and Other's few words. Optional. */
  heardAbout?: string | null;
  heardAboutDetail?: string | null;
  /**
   * They came from the office's "book a visit" link after a photo quote, so
   * they get a visit whatever the budget. Only ever widens to a visit, which
   * anybody gets by answering "Not sure yet" anyway.
   */
  wantsVisit?: boolean;
}

/** What was made: a visit (in person or on video), or a photo quote with no time at all. */
export interface PublicBookingMade {
  jobId: string;
  mode: EvaluationMode | "photo_quote";
  prepToken: string | null;
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
 * The one write path for the public /book flow — no logged-in user exists,
 * so this runs entirely on the service-role client (same pattern as the GHL
 * webhook). Re-validates everything server-side since none of it can be
 * trusted from the client.
 */
export async function submitPublicBooking(input: SubmitPublicBookingInput): Promise<PublicBookingMade> {
  // Made once: the same person sending the same booking twice at once (a
  // double tap, a resend on a slow phone) used to be booked twice. The
  // second waits for the first and is told about the same visit. A photo
  // quote has no time, so it is made once per person instead.
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return makePublicBooking(input);
  const slot = /^\d{4}-\d{2}-\d{2}$/.test(input.date) && /^\d{2}:\d{2}$/.test(input.time) ? `${input.date}T${input.time}` : "photo-quote";
  const admin = createAdminClient();
  const key = bookingPageKey(input.organizationId, email, slot);
  const claim = await claimBooking(admin, key);
  if (!claim.won) {
    if (!claim.jobId) throw new Error("Your booking is still going through. Give it a moment, then refresh the page.");
    const [{ data: job }, { data: intake }] = await Promise.all([
      admin.from("jobs").select("evaluation_mode, evaluation_date").eq("id", claim.jobId).maybeSingle(),
      admin.from("evaluation_intakes").select("token").eq("job_id", claim.jobId).maybeSingle(),
    ]);
    const mode = job && !job.evaluation_date ? "photo_quote" : ((job?.evaluation_mode ?? "in_person") as EvaluationMode);
    return { jobId: claim.jobId, mode, prepToken: intake?.token ?? null };
  }
  try {
    const made = await makePublicBooking(input);
    await settleClaim(admin, key, made.jobId);
    return made;
  } catch (err) {
    await releaseClaim(admin, key).catch(() => undefined);
    throw err;
  }
}

async function makePublicBooking(input: SubmitPublicBookingInput): Promise<PublicBookingMade> {
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
  // Optional, and it has to actually be optional. The form has said so since
  // the brackets were added, but this refused a blank one — so anybody who
  // skipped the question lost the appointment on the final click, which is
  // the exact failure the "Not sure yet" bracket was added to prevent.
  const budgetRange = input.budgetRange?.trim() ?? "";
  if (budgetRange && !BUDGET_RANGES.includes(budgetRange as (typeof BUDGET_RANGES)[number])) {
    throw new Error("Select a budget range.");
  }

  const admin = createAdminClient();
  const adClick = cleanAdClick(input.adClick);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error("This booking link isn't valid anymore.");

  // A visit, or a quote from photos. Decided here from the budget and the
  // owner's line, whatever the page did: the page only uses the same rule to
  // know whether to show the times. Before the migration, and with the
  // switch off, everybody gets a visit, as they always have.
  const photoQuotes = await readPhotoQuotes(admin, input.organizationId).catch(() => null);
  const route = input.wantsVisit ? "visit" : routeForBudget(budgetRange, photoQuotes?.ready ? photoQuotes : null);
  const visit = route === "visit" ? await pickVisit(admin, input, address) : null;

  const { data: activeServices, error: servicesError } = await admin
    .from("services")
    .select("service_type_id")
    .eq("organization_id", input.organizationId)
    .eq("status", "active");
  if (servicesError) throw servicesError;
  const validServiceIds = new Set((activeServices ?? []).map((s) => s.service_type_id));
  const requestedServiceIds = input.requestedServiceTypeIds.filter((id) => validServiceIds.has(id));

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
        source: bookingSource(adClick, await knownReferralCode(admin, input.organizationId, input.referralCode)),
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

  // Decided here as well as in the browser. The client is told which kind of
  // evaluation they are getting before they pick a time, but what is written
  // down is worked out from the coordinates on the server, where nobody can
  // edit it into a free visit three states away.
  const mode = modeForAddress(input.lat, input.lng, address);

  // Only a code we actually issued. Anybody can put ?rec=whatever in a URL,
  // and a made-up code stored on a job would show up as a booking credited to
  // a group nobody ever posted in.
  const referralCode = await knownReferralCode(admin, input.organizationId, input.referralCode);

  // A photo quote, or a visit for a property that already has one waiting,
  // stays on that one job: the office's "needs a visit" link and a second
  // try on the form both land where the photos already are.
  const waitingJobId = await waitingPhotoQuoteJob(admin, propertyId);
  if (!visit && waitingJobId) {
    const { data: waitingIntake } = await admin.from("evaluation_intakes").select("token").eq("job_id", waitingJobId).maybeSingle();
    log.info("booking.photo_quote_reused", { jobId: waitingJobId, customerId });
    return { jobId: waitingJobId, mode: "photo_quote", prepToken: waitingIntake?.token ?? null };
  }

  const shared = {
    evaluation_mode: mode.mode,
    referral_code: referralCode,
    booking_variant: isVariant(input.bookingVariant) ? input.bookingVariant : null,
    address_entry: input.addressEntry === "located" || input.addressEntry === "typed" ? input.addressEntry : null,
    client_notes: input.notes.trim() || null,
    budget_range: budgetRange || null,
    referred_by_profile_id: input.referredByProfileId,
    ...cleanHeardAbout(input.heardAbout, input.heardAboutDetail),
  };

  let jobId: string;
  if (visit && waitingJobId) {
    // The visit goes on the photo quote's job. Only what the booking adds is
    // written: a blank note or budget doesn't wipe what the first one said.
    const { error: updateError } = await admin
      .from("jobs")
      .update({
        assigned_to: visit.evaluatorId,
        evaluation_date: visit.iso,
        evaluation_status: "scheduled",
        evaluation_mode: mode.mode,
        ...(shared.client_notes ? { client_notes: shared.client_notes } : {}),
        ...(shared.budget_range ? { budget_range: shared.budget_range } : {}),
      })
      .eq("id", waitingJobId);
    if (updateError) throw updateError;
    jobId = waitingJobId;
    // Off the office's waiting list: a visit is what it was waiting for.
    await untyped(admin)
      .from("evaluation_intakes")
      .update({ photo_quote_outcome: "visit", photo_quote_outcome_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .is("photo_quote_outcome", null);
  } else {
    const { data: job, error: jobError } = await admin
      .from("jobs")
      .insert({
        property_id: propertyId,
        name: `${address}, Estimate`,
        // A photo quote has nobody going out and no time: the office prices it.
        assigned_to: visit?.evaluatorId ?? null,
        evaluation_date: visit?.iso ?? null,
        evaluation_status: "scheduled",
        ...shared,
      })
      .select()
      .single();
    if (jobError) throw jobError;
    jobId = job.id;
  }

  // The form a photo quote is sent on. The trigger only makes one for a job
  // with a date, so this one is made here, marked as a photo quote.
  if (!visit) {
    const { error: intakeError } = await untyped(admin)
      .from("evaluation_intakes")
      .upsert({ organization_id: input.organizationId, job_id: jobId, photo_quote: true }, { onConflict: "job_id" });
    if (intakeError) throw intakeError;
  }

  // The visit this booking came from, so the test reads bookings over visits.
  if (input.visitId && UUID_RE.test(input.visitId)) {
    await admin
      .from("booking_visits")
      .update({ booked_job_id: jobId, booked_at: new Date().toISOString() })
      .eq("id", input.visitId)
      .is("booked_job_id", null);
  }

  if (requestedServiceIds.length > 0) {
    const { error: requestedError } = await admin.from("job_requested_services").upsert(
      requestedServiceIds.map((serviceTypeId) => ({
        job_id: jobId,
        organization_id: input.organizationId,
        service_type_id: serviceTypeId,
      })),
      { onConflict: "job_id,service_type_id", ignoreDuplicates: true }
    );
    if (requestedError) throw requestedError;
  }

  // Which ad it came from, kept with the job, and the booking told to Meta.
  // Never in the way of the booking.
  const who = await requestHeaders();
  await recordBookingAdClick(admin, {
    jobId,
    organizationId: input.organizationId,
    click: adClick,
    email,
    phone,
    ip: who.ip,
    userAgent: who.userAgent,
  }).catch((err) => log.warn("booking.meta_failed", { jobId, error: err instanceof Error ? err.message : String(err) }));

  // They've just become a client — take them off the cold-prospect list now
  // rather than at the next nightly sweep.
  await reconcileProspects(admin).catch(() => null);

  // The lead, and the visit if they picked a time, for the event backbone.
  // Off unless switched on; never in the way of the booking.
  await recordBooking(jobId, "booking_page");

  if (visit) {
    // Onto the GoHighLevel calendar too, so the office sees one calendar.
    // Never fails the booking: it logs and moves on if GoHighLevel is down.
    await syncEvaluationToGhl(jobId);

    // "You're booked", now, not at tomorrow's reminder run.
    await sendEvaluationConfirmationNow(jobId);
  }

  // And give them a way back in. No password: they ask for a code when they
  // want to see their quote again, instead of hunting for our email. Carries
  // no organization, so the signup trigger gives it no staff access at all.
  await ensureClientAccount({ customerId, email }).catch(() => null);

  // The pre-evaluation form is made by a trigger the moment the job has a
  // date (or above, for a photo quote), so the client can be handed the link
  // on the very next screen.
  const { data: intake } = await admin.from("evaluation_intakes").select("token").eq("job_id", jobId).maybeSingle();

  // The link by email as well, for a photo quote, so closing the tab
  // doesn't lose it. A visit's link is in its confirmation already.
  if (!visit && intake?.token) await sendPhotoQuoteLinkNow(jobId, intake.token);

  log.info("booking.created", {
    jobId,
    customerId,
    evaluatorId: visit?.evaluatorId ?? null,
    at: visit?.iso ?? null,
    date: visit ? input.date : null,
    time: visit ? input.time : null,
    mode: visit ? mode.mode : "photo_quote",
    referralCode,
    services: requestedServiceIds.length,
    prepForm: Boolean(intake?.token),
    joinedPhotoQuote: Boolean(visit && waitingJobId),
  });

  return { jobId, mode: visit ? mode.mode : "photo_quote", prepToken: intake?.token ?? null };
}

/**
 * The visit they picked, checked again now: a real time, far enough ahead,
 * still free, and who of the people free then gets it.
 */
async function pickVisit(
  admin: ReturnType<typeof createAdminClient>,
  input: SubmitPublicBookingInput,
  address: string
): Promise<{ iso: string; evaluatorId: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error("Select a date and time.");
  }
  if (input.candidateEvaluatorIds.length === 0) {
    throw new Error("That time is no longer available, please pick another.");
  }

  // The notice rule, checked at submit as well as when the times were drawn.
  // A page left open overnight offers a slot that was tomorrow and is today.
  const notice = await getBookingNotice(input.organizationId);

  // "Monday at 8" is a wall clock on the business's zone. Written as the
  // instant it means there, so every screen in every zone reads it back as
  // Monday at 8. This used to be parsed on the server's own clock, which
  // is UTC, and showed as four in the morning on every phone in Maryland.
  const evaluationDateTime = zonedToUtc(input.date, input.time, notice.timeZone);
  if (Number.isNaN(evaluationDateTime.getTime())) throw new Error("Select a date and time.");
  const iso = evaluationDateTime.toISOString();
  const soon = tooSoon(notice, new Date(), { date: input.date, at: evaluationDateTime });
  if (soon) throw new Error(soon);

  // Re-checked at submit, not merely when the slots were drawn: a booking page
  // can sit open on somebody's phone for an hour, and two people can be on it
  // at once. This used to compare the exact timestamp only, so an appointment
  // that merely overlapped — or a whole day the crew were on an install —
  // sailed straight through.
  const end = new Date(evaluationDateTime.getTime() + SLOT_MINUTES * 60_000);
  const blocks = await getBusyBlocksAsAdmin().catch(() => []);

  const stillFree = freeOf(blocks, input.candidateEvaluatorIds, { start: evaluationDateTime, end });
  if (stillFree.length === 0) throw new Error("That time was just booked, please pick another.");

  // Which of the free ones, rather than whichever the database named first.
  // That used to decide it, so one person collected the bookings and the rest
  // waited. Now it goes to whoever is already going that way, and failing
  // that to whoever has the lightest day.
  // Their territory first, when evaluators have one (zip codes or an area
  // drawn on the map) and somebody whose patch it is is free.
  const { territories } = await loadTerritories(admin, input.organizationId).catch(() => ({ territories: [] }));
  const choice = chooseEvaluator(
    stillFree,
    await daysFor(admin, stillFree, input.date),
    { lat: input.lat, lng: input.lng, zip: zipOf(address) },
    territories
  );
  if (!choice) throw new Error("That time was just booked, please pick another.");
  return { iso, evaluatorId: choice.evaluatorId };
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
