import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { createAppointment, isGhlConfigured, updateAppointment, upsertContact } from "@/lib/ghl/client";
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
      "id, evaluation_date, evaluation_end_date, evaluation_status, evaluation_mode, ghl_appointment_id, property:properties(address, customer:customers(id, name, email, phone, ghl_contact_id))"
    )
    .eq("id", jobId)
    .maybeSingle();
  return (data as unknown as Row) ?? null;
}

/** Puts the evaluation on the calendar, or moves it if it is already there. */
export async function syncEvaluationToGhl(jobId: string): Promise<void> {
  if (!isGhlConfigured) return;
  try {
    const job = await loadJob(jobId);
    if (!job || !job.evaluation_date || !job.property?.customer) return;
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
      return;
    }
    if (job.evaluation_status === "cancelled") return;

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
    });
    await admin.from("jobs").update({ ghl_appointment_id: appointmentId }).eq("id", jobId);
    log.info("ghl.appointment.created", { jobId, appointmentId });
  } catch (err) {
    log.warn("ghl.sync.failed", { jobId, error: err instanceof Error ? err.message : String(err) });
  }
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
