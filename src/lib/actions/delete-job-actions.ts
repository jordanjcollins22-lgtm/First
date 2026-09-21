"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { canDeleteJob } from "@/lib/duplicate-jobs";
import { log } from "@/lib/log";

export type DeleteJobResult = { ok: true; message: string } | { ok: false; message: string };

/** Somebody looked and it is more work, not a copy. The board stops asking. */
export async function markNotDuplicate(jobId: string): Promise<DeleteJobResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) {
      return { ok: false, message: "Only an owner or admin can decide that." };
    }
    const supabase = await createClient();
    const { error } = await supabase.from("jobs").update({ duplicate_cleared_at: new Date().toISOString() }).eq("id", jobId);
    if (error) return { ok: false, message: error.message };
    for (const path of ["/pipeline", "/my-day", `/jobs/${jobId}`]) revalidatePath(path);
    return { ok: true, message: "Kept. It will not be called a duplicate again." };
  } catch (err) {
    log.error("job.not_duplicate_failed", { jobId, error: String(err) });
    return { ok: false, message: "Couldn't save that." };
  }
}

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

    // The same checks the button shows, so the answer here never surprises
    // the answer on the page. The database runs them again before it acts.
    const supabase = await createClient();
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

    // One function does the delete: it keeps a snapshot of the job and its
    // audit trail, lets the cascade through the append-only trail, and
    // sweeps a spare address and client behind it.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("delete_job", { the_job: jobId, by: profile.id, why: "Duplicate booking, deleted by hand." });
    if (error) return { ok: false, message: error.message };
    const result = (data ?? {}) as { property_removed?: boolean; customer_removed?: boolean };
    log.info("job.deleted", { jobId, by: profile.id, ...result });

    const swept = result.property_removed
      ? result.customer_removed
        ? " The spare address and client record went with it."
        : " The spare address went with it."
      : "";
    for (const path of ["/pipeline", "/my-day", "/jobs", "/clients", "/calendar"]) revalidatePath(path);
    return { ok: true, message: `Deleted.${swept}` };
  } catch (err) {
    log.error("job.delete_failed", { jobId, error: String(err) });
    return { ok: false, message: "Couldn't delete that." };
  }
}
