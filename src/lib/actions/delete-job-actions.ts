"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { canDeleteJob } from "@/lib/duplicate-jobs";
import { log } from "@/lib/log";

export type DeleteJobResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Deletes a job outright. For copies, not for history.
 *
 * Only an owner or admin, and only a job with nothing of value on it: no
 * payment, no invoice, no accepted proposal, no hours. Everything hanging
 * off the job goes with it. The property goes too when this was its only
 * job and no county house is linked to it, and the client goes when that
 * was their only property and nothing else remembers them, so a booking
 * the calendar made twice leaves no second client behind.
 */
export async function deleteDuplicateJob(jobId: string): Promise<DeleteJobResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) {
      return { ok: false, message: "Only an owner or admin can delete a job." };
    }

    const supabase = await createClient();
    const { data: job } = await supabase
      .from("jobs")
      .select("id, property_id, property:properties!inner(id, customer_id, customer:customers!inner(id, organization_id))")
      .eq("id", jobId)
      .maybeSingle();
    const row = job as unknown as { id: string; property_id: string; property: { id: string; customer_id: string; customer: { id: string; organization_id: string } } } | null;
    if (!row || row.property.customer.organization_id !== profile.organization_id) return { ok: false, message: "Couldn't find that job." };

    const count = async (table: "payments" | "invoices" | "job_work_sessions" | "time_entries") => {
      const { count: n } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("job_id", jobId);
      return n ?? 0;
    };
    const [payments, invoices, workSessions, timeEntries, { data: proposal }] = await Promise.all([
      count("payments"),
      count("invoices"),
      count("job_work_sessions"),
      count("time_entries"),
      supabase.from("job_proposals").select("status").eq("job_id", jobId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const verdict = canDeleteJob({ payments, invoices, workSessions, timeEntries, proposalStatus: proposal?.status ?? null });
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    // The admin client, because the job's children carry their own row
    // policies and a delete that leaves half of them behind is worse than
    // no delete.
    const admin = createAdminClient();
    const { error } = await admin.from("jobs").delete().eq("id", jobId);
    if (error) return { ok: false, message: error.message };
    log.info("job.deleted", { jobId, by: profile.id });

    let swept = "";
    const propertyId = row.property.id;
    const [{ count: otherJobs }, { count: houses }] = await Promise.all([
      admin.from("jobs").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
      admin.from("houses").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
    ]);
    if ((otherJobs ?? 0) === 0 && (houses ?? 0) === 0) {
      const { error: propertyError } = await admin.from("properties").delete().eq("id", propertyId);
      if (!propertyError) {
        swept = " The address went with it";
        const customerId = row.property.customer.id;
        const { count: properties } = await admin.from("properties").select("id", { count: "exact", head: true }).eq("customer_id", customerId);
        if ((properties ?? 0) === 0) {
          // Refused by the database when anything still points at them,
          // which is the right answer: a client with an email history stays.
          const { error: customerError } = await admin.from("customers").delete().eq("id", customerId);
          if (!customerError) swept += ", and so did the spare client record";
        }
        swept += ".";
      }
    }

    for (const path of ["/pipeline", "/my-day", "/jobs", "/clients", "/calendar"]) revalidatePath(path);
    return { ok: true, message: `Deleted.${swept}` };
  } catch (err) {
    log.error("job.delete_failed", { jobId, error: String(err) });
    return { ok: false, message: "Couldn't delete that." };
  }
}
