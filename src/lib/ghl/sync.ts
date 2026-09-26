import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { createAppointment, isGhlConfigured, listUsers, updateAppointment, upsertContact } from "@/lib/ghl/client";
import { appointmentTitle, appointmentWindow, splitName } from "@/lib/ghl/payload";

/**
 * Keeps the GoHighLevel calendar in step with the app's evaluations.
 *
 * Called after a booking, a move or a cancellation. Never awaited by the
 * thing that called it in a way that can fail the booking: the app is the
 * record, GoHighLevel is a mirror, and a mirror that is down is a log line,
 * not a client who could not book.
 */
type Row = {
  id: string;
  evaluation_date: string | null;
  evaluation_end_date: string | null;
  evaluation_status: string;
  evaluation_mode: string;
  ghl_appointment_id: string | null;
  assigned_to: string | null;
  property: {
    address: string;
    customer: { id: string; name: string; email: string | null; phone: string | null; ghl_contact_id: string | null } | null;
  } | null;
};

async function loadJob(jobId: string): Promise<Row | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select(
      "id, evaluation_date, evaluation_end_date, evaluation_status, evaluation_mode, ghl_appointment_id, assigned_to, property:properties(address, customer:customers(id, name, email, phone, ghl_contact_id))"
    )
    .eq("id", jobId)
    .maybeSingle();
  return (data as unknown as Row) ?? null;
}

export type GhlSyncResult = { ok: true; appointmentId: string | null } | { ok: false; error: string };

/** Puts the evaluation on the calendar, or moves it if it is already there. */
export async function syncEvaluationToGhl(jobId: string): Promise<GhlSyncResult> {
  if (!isGhlConfigured) return { ok: false, error: "GoHighLevel is not set up on this site." };
  try {
    const job = await loadJob(jobId);
    if (!job) return { ok: false, error: "Couldn't find that job." };
    if (!job.evaluation_date) return { ok: false, error: "There is no evaluation time to put on the calendar." };
    if (!job.property?.customer) return { ok: false, error: "The job has no client to put on the calendar." };
    const customer = job.property.customer;
    const admin = createAdminClient();

    const window = appointmentWindow({ startsAt: job.evaluation_date, endsAt: job.evaluation_end_date });
    const title = appointmentTitle({ customerName: customer.name, address: job.property.address, mode: job.evaluation_mode });

    if (job.ghl_appointment_id) {
      await updateAppointment(job.ghl_appointment_id, {
        title,
        ...window,
        appointmentStatus: job.evaluation_status === "cancelled" ? "cancelled" : "confirmed",
      });
      log.info("ghl.appointment.updated", { jobId, appointmentId: job.ghl_appointment_id });
      return { ok: true, appointmentId: job.ghl_appointment_id };
    }
    if (job.evaluation_status === "cancelled") return { ok: true, appointmentId: null };

    let contactId = customer.ghl_contact_id;
    if (!contactId) {
      contactId = await upsertContact({
        ...splitName(customer.name),
        email: customer.email,
        phone: customer.phone,
        address: job.property.address,
      });
      await admin.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
    }

    const appointmentId = await createAppointment({
      contactId,
      title,
      ...window,
      address: job.property.address,
      assignedUserId: await ghlUserFor(job.assigned_to),
    });
    await admin.from("jobs").update({ ghl_appointment_id: appointmentId }).eq("id", jobId);
    log.info("ghl.appointment.created", { jobId, appointmentId });
    return { ok: true, appointmentId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("ghl.sync.failed", { jobId, error });
    return { ok: false, error };
  }
}

/**
 * Hands the calendar entry to whoever the evaluation is assigned to now.
 *
 * An evaluation never put on the calendar has nothing to hand over, and one
 * whose new evaluator GoHighLevel does not know stays where it was rather
 * than landing on a stand-in: a stand-in is right for a new booking the
 * calendar would otherwise refuse, and wrong for moving somebody's visit.
 */
export async function reassignEvaluationInGhl(jobId: string): Promise<GhlSyncResult> {
  if (!isGhlConfigured) return { ok: true, appointmentId: null };
  try {
    const job = await loadJob(jobId);
    if (!job?.ghl_appointment_id) return { ok: true, appointmentId: null };
    const user = job.assigned_to ? await ghlUserFor(job.assigned_to, { standIn: false }) : null;
    if (!user) return { ok: false, error: "GoHighLevel doesn't know the new evaluator, so the calendar entry stayed with the old one." };
    await updateAppointment(job.ghl_appointment_id, { assignedUserId: user });
    log.info("ghl.appointment.reassigned", { jobId, appointmentId: job.ghl_appointment_id });
    return { ok: true, appointmentId: job.ghl_appointment_id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("ghl.reassign.failed", { jobId, error });
    return { ok: false, error };
  }
}

/**
 * The GoHighLevel user an evaluation goes on the calendar under.
 *
 * Its calendar refuses an appointment with nobody on it. The evaluator is
 * matched by email against GoHighLevel's team list once and remembered on
 * their profile; with no evaluator, or one GoHighLevel does not know, the
 * first teammate anybody has matched stands in, so the booking still lands.
 */
async function ghlUserFor(profileId: string | null, options: { standIn?: boolean } = {}): Promise<string | null> {
  const standIn = options.standIn !== false;
  const admin = createAdminClient();
  const { data: known } = await admin.from("profiles").select("id, email, ghl_user_id").not("ghl_user_id", "is", null).limit(20);
  const remembered = (known ?? []).find((p) => p.id === profileId)?.ghl_user_id ?? null;
  if (remembered) return remembered;

  let users: Awaited<ReturnType<typeof listUsers>> = [];
  try {
    users = await listUsers();
  } catch {
    return standIn ? (known ?? [])[0]?.ghl_user_id ?? null : null;
  }
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.trim().toLowerCase(), u.id]));

  if (profileId) {
    const { data: profile } = await admin.from("profiles").select("email").eq("id", profileId).maybeSingle();
    const match = profile?.email ? byEmail.get(profile.email.trim().toLowerCase()) : null;
    if (match) {
      await admin.from("profiles").update({ ghl_user_id: match }).eq("id", profileId);
      return match;
    }
  }
  if (!standIn) return null;
  if ((known ?? []).length > 0) return known![0].ghl_user_id;
  // Nobody matched yet: any teammate GoHighLevel lists, so the calendar takes it.
  return users[0]?.id ?? null;
}

/** Marks the calendar entry cancelled. Nothing to do when it was never there. */
export async function cancelEvaluationInGhl(jobId: string): Promise<void> {
  if (!isGhlConfigured) return;
  try {
    const job = await loadJob(jobId);
    if (!job?.ghl_appointment_id) return;
    await updateAppointment(job.ghl_appointment_id, { appointmentStatus: "cancelled" });
    log.info("ghl.appointment.cancelled", { jobId, appointmentId: job.ghl_appointment_id });
  } catch (err) {
    log.warn("ghl.sync.failed", { jobId, error: err instanceof Error ? err.message : String(err) });
  }
}
