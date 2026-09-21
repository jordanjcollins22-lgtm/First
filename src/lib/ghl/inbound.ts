import { createAdminClient } from "@/lib/supabase/admin";
import { syncEvaluationToGhl } from "@/lib/ghl/sync";
import { log } from "@/lib/log";
import { modeForAddress } from "@/lib/evaluation-mode";
import { firstAcceptable } from "@/lib/geocode-guard";
import { searchAddress } from "@/lib/mapbox-geocoding";
import { getContact, isGhlConfigured, listAppointments } from "@/lib/ghl/client";
import { planChanges, type GhlEvent, type KnownJob } from "@/lib/ghl/plan";

/**
 * Bookings made in GoHighLevel, brought into the app.
 *
 * The app reads the evaluation calendar and makes the app match it: a
 * booking made there becomes a client, a property and a job here; one
 * moved there moves here; one cancelled there is cancelled here. Read
 * when somebody opens the Calendar or My Day, at most every few minutes,
 * and once a day on its own, so the office never needs a workflow in
 * GoHighLevel to tell the app what its own calendar says.
 */
const STALE_AFTER_MS = 5 * 60_000;
const LOOK_BACK_DAYS = 7;
const LOOK_AHEAD_DAYS = 90;

export interface GhlBookingInput {
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string;
  startsAt: string;
  endsAt: string | null;
  appointmentId: string | null;
  contactId: string | null;
}

export type GhlBookingResult = { ok: true; jobId: string; customerId: string; propertyId: string } | { ok: false; error: string };

/**
 * One booking from GoHighLevel, written as the app writes its own.
 *
 * Shared by the webhook and the calendar pull, so both doors make the same
 * client, property and job. The address is checked before it is used: a
 * thin address matches a real street in the wrong state, and this writes
 * a property with nobody looking.
 */
export async function createBookingFromGhl(input: GhlBookingInput): Promise<GhlBookingResult> {
  const admin = createAdminClient();

  const matches = await searchAddress(input.address, undefined, { autocomplete: false });
  const checked = firstAcceptable(input.address, matches);
  if (!checked.match) return { ok: false, error: `Couldn't place that address: ${input.address}. ${checked.reason ?? ""}`.trim() };
  const { lat, lng, fullAddress } = checked.match;

  // The client, found before made: by their GoHighLevel contact, then by
  // email, then by phone. A booking from the calendar is nearly always
  // somebody the app already has.
  let customerId: string | null = null;
  if (input.contactId) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("ghl_contact_id", input.contactId)
      .limit(1)
      .maybeSingle();
    customerId = data?.id ?? null;
  }
  if (!customerId && input.email) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", input.organizationId)
      .ilike("email", input.email.trim())
      .maybeSingle();
    customerId = data?.id ?? null;
  }
  if (!customerId && input.phone) {
    const last = input.phone.replace(/\D/g, "").slice(-10);
    if (last.length >= 7) {
      const { data } = await admin
        .from("customers")
        .select("id, phone")
        .eq("organization_id", input.organizationId)
        .ilike("phone", `%${last.slice(-4)}`)
        .limit(20);
      customerId = ((data ?? []) as { id: string; phone: string | null }[]).find((c) => (c.phone ?? "").replace(/\D/g, "").slice(-10) === last)?.id ?? null;
    }
  }
  if (!customerId) {
    const { data, error } = await admin
      .from("customers")
      .insert({ organization_id: input.organizationId, name: input.name, email: input.email, phone: input.phone, ghl_contact_id: input.contactId })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    customerId = data.id;
  } else if (input.contactId) {
    await admin.from("customers").update({ ghl_contact_id: input.contactId }).eq("id", customerId).is("ghl_contact_id", null);
  }

  // Their property at this address, if they already have one; a second
  // row for the same house splits its history in two.
  let propertyId: string | null = null;
  {
    const { data: theirs } = await admin.from("properties").select("id, address, lat, lng").eq("customer_id", customerId).limit(50);
    const found = ((theirs ?? []) as { id: string; address: string; lat: number | null; lng: number | null }[]).find(
      (p) => sameAddress(p.address, fullAddress) || (p.lat != null && p.lng != null && Math.abs(p.lat - lat) < 0.0003 && Math.abs(p.lng - lng) < 0.0004)
    );
    propertyId = found?.id ?? null;
  }
  if (!propertyId) {
    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({ customer_id: customerId, address: fullAddress, lat, lng })
      .select("id")
      .single();
    if (propertyError) return { ok: false, error: propertyError.message };
    propertyId = property.id;
  }

  // One visit at one time. A job already booked here within an hour of this
  // one is this booking seen twice, not a second evaluation.
  const startsAt = new Date(input.startsAt).getTime();
  const { data: clash } = await admin
    .from("jobs")
    .select("id, evaluation_date")
    .eq("property_id", propertyId)
    .neq("status", "cancelled")
    .neq("evaluation_status", "cancelled")
    .not("evaluation_date", "is", null)
    .gte("evaluation_date", new Date(startsAt - 3_600_000).toISOString())
    .lte("evaluation_date", new Date(startsAt + 3_600_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (clash) {
    if (input.appointmentId) await admin.from("jobs").update({ ghl_appointment_id: input.appointmentId }).eq("id", clash.id).is("ghl_appointment_id", null);
    return { ok: true, jobId: clash.id, customerId, propertyId };
  }

  // Jace is the only person who does evaluations, so a booking made in
  // GoHighLevel is his. When several people do, nobody is guessed.
  const { data: evaluators } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("does_evaluations", true);
  const assignedTo = evaluators && evaluators.length === 1 ? evaluators[0].id : null;

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      property_id: propertyId,
      name: `${fullAddress} — Evaluation`,
      status: "estimating",
      assigned_to: assignedTo,
      evaluation_date: input.startsAt,
      evaluation_end_date: input.endsAt,
      evaluation_status: "scheduled",
      evaluation_mode: modeForAddress(lat, lng, fullAddress).mode,
      ghl_appointment_id: input.appointmentId,
    })
    .select("id")
    .single();
  if (jobError) return { ok: false, error: jobError.message };

  return { ok: true, jobId: job.id, customerId, propertyId };
}

/** "3 Idlewild Court, Bel Air" and "3 Idlewild Ct, Bel Air, MD 21014" are one house. */
function sameAddress(a: string, b: string): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(court|ct)\b/g, "ct")
      .replace(/\b(drive|dr)\b/g, "dr")
      .replace(/\b(road|rd)\b/g, "rd")
      .replace(/\b(street|st)\b/g, "st")
      .replace(/\b(lane|ln)\b/g, "ln")
      .replace(/\b(avenue|ave)\b/g, "ave")
      .replace(/\b(circle|cir)\b/g, "cir")
      .replace(/\b(place|pl)\b/g, "pl")
      .replace(/\b(way)\b/g, "way")
      .split(",")
      .slice(0, 2)
      .join(",")
      .replace(/[^a-z0-9,]/g, "");
  return key(a) === key(b);
}

/** Reads the calendar now, whatever the clock says. */
export async function pullGhlCalendar(organizationId: string): Promise<{ ok: boolean; summary: string }> {
  if (!isGhlConfigured) return { ok: false, summary: "GoHighLevel is not set up." };
  const admin = createAdminClient();
  const now = new Date();
  // One GoHighLevel account, one business. The keys are site-wide, so
  // every organization on the site could read the same calendar and each
  // would make its own copy of every booking. Only the business that has
  // put something on that calendar reads it back.
  if (!(await ownsGhlCalendar(admin, organizationId))) {
    return { ok: false, summary: "GoHighLevel is another business's calendar." };
  }
  try {
    const events = await listAppointments(
      new Date(now.getTime() - LOOK_BACK_DAYS * 86_400_000),
      new Date(now.getTime() + LOOK_AHEAD_DAYS * 86_400_000)
    );

    const { data: jobRows } = await admin
      .from("jobs")
      .select("id, ghl_appointment_id, evaluation_date, evaluation_end_date, evaluation_status, status, property:properties!inner(customer:customers!inner(organization_id, email, phone, ghl_contact_id))")
      .not("evaluation_date", "is", null)
      .gte("evaluation_date", new Date(now.getTime() - LOOK_BACK_DAYS * 86_400_000).toISOString());
    type Row = {
      id: string;
      ghl_appointment_id: string | null;
      evaluation_date: string | null;
      evaluation_end_date: string | null;
      evaluation_status: string;
      status: string;
      property: { customer: { organization_id: string; email: string | null; phone: string | null; ghl_contact_id: string | null } };
    };
    const jobs: KnownJob[] = ((jobRows ?? []) as unknown as Row[])
      .filter((r) => r.property.customer.organization_id === organizationId)
      .map((r) => ({
        id: r.id,
        ghlAppointmentId: r.ghl_appointment_id,
        evaluationAt: r.evaluation_date,
        evaluationEndAt: r.evaluation_end_date,
        cancelled: r.evaluation_status === "cancelled" || r.status === "cancelled",
        email: r.property.customer.email,
        phone: r.property.customer.phone,
        ghlContactId: r.property.customer.ghl_contact_id,
      }));

    // Contacts are only fetched for appointments the app has not seen, and
    // each once, so a calendar of a hundred known visits costs one call.
    const contacts = new Map<string, Awaited<ReturnType<typeof getContact>>>();
    const known = new Set(jobs.map((j) => j.ghlAppointmentId).filter(Boolean));
    for (const e of events) {
      if (e.contactId && !known.has(e.id) && e.appointmentStatus !== "cancelled" && !contacts.has(e.contactId)) {
        contacts.set(e.contactId, await getContact(e.contactId));
      }
    }

    const ghlEvents: GhlEvent[] = events.map((e) => ({
      id: e.id,
      contactId: e.contactId,
      startTime: new Date(e.startTime).toISOString(),
      endTime: e.endTime ? new Date(e.endTime).toISOString() : null,
      cancelled: e.appointmentStatus === "cancelled" || e.appointmentStatus === "noshow" || e.appointmentStatus === "invalid",
    }));

    const changes = planChanges(ghlEvents, jobs, (id) => {
      const c = id ? contacts.get(id) : null;
      return c ? { id: c.id, email: c.email, phone: c.phone } : null;
    });

    const counts = { created: 0, moved: 0, cancelled: 0, reinstated: 0, linked: 0, failed: 0 };
    for (const change of changes) {
      if (change.kind === "skip") continue;
      if (change.kind === "move") {
        await admin.from("jobs").update({ evaluation_date: change.startTime, evaluation_end_date: change.endTime }).eq("id", change.jobId);
        counts.moved += 1;
      } else if (change.kind === "cancel") {
        await admin.from("jobs").update({ evaluation_status: "cancelled", cancellation_reason: "Cancelled in GoHighLevel." }).eq("id", change.jobId);
        counts.cancelled += 1;
      } else if (change.kind === "reinstate") {
        await admin
          .from("jobs")
          .update({ evaluation_status: "scheduled", evaluation_date: change.startTime, evaluation_end_date: change.endTime, cancellation_reason: null })
          .eq("id", change.jobId);
        counts.reinstated += 1;
      } else if (change.kind === "link") {
        await admin.from("jobs").update({ ghl_appointment_id: change.appointmentId }).eq("id", change.jobId);
        counts.linked += 1;
      } else if (change.kind === "create") {
        const raw = events.find((e) => e.id === change.event.id);
        const contact = change.event.contactId ? contacts.get(change.event.contactId) : null;
        const address = contact?.address || raw?.address || null;
        if (!contact || !address) {
          log.warn("ghl.pull.unplaceable", { appointmentId: change.event.id, reason: contact ? "no address on the contact" : "no contact" });
          counts.failed += 1;
          continue;
        }
        const name = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "GoHighLevel booking";
        const made = await createBookingFromGhl({
          organizationId,
          name,
          email: contact.email,
          phone: contact.phone,
          address,
          startsAt: change.event.startTime,
          endsAt: change.event.endTime,
          appointmentId: change.event.id,
          contactId: contact.id,
        });
        if (made.ok) {
          counts.created += 1;
          log.info("ghl.pull.created", { jobId: made.jobId, appointmentId: change.event.id });
        } else {
          counts.failed += 1;
          log.warn("ghl.pull.failed", { appointmentId: change.event.id, error: made.error });
        }
      }
    }

    const summary = `${events.length} on the calendar: ${counts.created} created, ${counts.moved} moved, ${counts.cancelled} cancelled, ${counts.reinstated} reinstated, ${counts.linked} linked, ${counts.failed} failed.`;
    await admin.from("ghl_sync_state").upsert({ organization_id: organizationId, last_pulled_at: now.toISOString(), last_result: summary });
    log.info("ghl.pull.done", { organizationId, ...counts, events: events.length });
    return { ok: true, summary };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await admin.from("ghl_sync_state").upsert({ organization_id: organizationId, last_pulled_at: now.toISOString(), last_result: `Failed: ${error}` });
    log.warn("ghl.pull.failed", { organizationId, error });
    return { ok: false, summary: error };
  }
}

/**
 * Whether this business is the one on the GoHighLevel account: somebody on
 * its team is matched to a GoHighLevel user, or one of its clients is a
 * GoHighLevel contact. A business that has never touched the calendar has
 * no business reading it.
 */
async function ownsGhlCalendar(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<boolean> {
  const [{ count: people }, { count: clients }] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).not("ghl_user_id", "is", null),
    admin.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).not("ghl_contact_id", "is", null),
  ]);
  return (people ?? 0) > 0 || (clients ?? 0) > 0;
}

/** Reads the calendar unless it was read in the last few minutes. */
export async function pullGhlCalendarIfStale(organizationId: string): Promise<void> {
  if (!isGhlConfigured) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("ghl_sync_state").select("last_pulled_at").eq("organization_id", organizationId).maybeSingle();
    const last = data?.last_pulled_at ? new Date(data.last_pulled_at).getTime() : 0;
    if (Date.now() - last < STALE_AFTER_MS) return;
    // Claimed before the read, so two people opening the app together do
    // not both ask GoHighLevel.
    await admin.from("ghl_sync_state").upsert({ organization_id: organizationId, last_pulled_at: new Date().toISOString() });
    await pullGhlCalendar(organizationId);
    await pushUnsyncedEvaluations(organizationId);
  } catch (err) {
    log.warn("ghl.pull.failed", { organizationId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The other direction: a visit booked here that never reached GoHighLevel.
 *
 * The push happens when a booking is made, and a push can fail: the
 * contact could not be made, the calendar was slow, the key was not set
 * yet. Rather than leave that visit missing from the calendar until somebody
 * notices, every stale-pull also tries again for any upcoming visit with no
 * appointment behind it. A handful at most, and each one is logged.
 */
async function pushUnsyncedEvaluations(organizationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, property:properties!inner(customer:customers!inner(organization_id))")
    .is("ghl_appointment_id", null)
    .eq("evaluation_status", "scheduled")
    .gte("evaluation_date", new Date().toISOString())
    .not("status", "in", "(cancelled,completed)")
    .eq("property.customer.organization_id", organizationId)
    .limit(20);
  for (const job of (data ?? []) as { id: string }[]) {
    const result = await syncEvaluationToGhl(job.id);
    if (!result.ok) log.warn("ghl.push.retry_failed", { jobId: job.id, error: result.error });
  }
}
