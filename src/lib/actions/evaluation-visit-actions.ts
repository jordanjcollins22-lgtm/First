"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { readPlan, type PlanItem } from "@/lib/evaluation-visit";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { zonedToUtc } from "@/lib/time-zone";

export type VisitResult = { ok: true } | { ok: false; message: string };

/**
 * The evaluator on the way to a visit, or there. Each is recorded once: a
 * second tap keeps the first time, which is the one that happened.
 */
export async function markVisit(jobId: string, step: "on_way" | "arrived"): Promise<VisitResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const supabase = await createClient();
  const { data: job, error: readError } = await supabase
    .from("jobs")
    .select("id, evaluation_status, evaluator_on_way_at, evaluator_arrived_at")
    .eq("id", jobId)
    .maybeSingle();
  if (readError || !job) return { ok: false, message: "Couldn't find that visit." };

  if (job.evaluation_status === "completed" || job.evaluation_status === "cancelled") return { ok: false, message: "This visit is already closed." };

  const now = new Date().toISOString();
  // The status the dashboards and the pipeline already read, and the times
  // behind it. "On my way" after arriving does not step back.
  const patch =
    step === "on_way"
      ? { evaluator_on_way_at: job.evaluator_on_way_at ?? now, ...(job.evaluation_status === "arrived" ? {} : { evaluation_status: "on_way" }) }
      : { evaluator_arrived_at: job.evaluator_arrived_at ?? now, evaluator_on_way_at: job.evaluator_on_way_at ?? now, evaluation_status: "arrived" };
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't save that, try again." };

  revalidatePath("/me/full");
  revalidateJobViews(jobId);
  return { ok: true };
}

/** Takes back "I've arrived" or "On my way", for a mis-tap. */
export async function undoVisit(jobId: string): Promise<VisitResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("evaluation_status, evaluator_arrived_at").eq("id", jobId).maybeSingle();
  if (!job || job.evaluation_status === "completed" || job.evaluation_status === "cancelled") return { ok: false, message: "This visit is already closed." };
  const patch = job.evaluator_arrived_at
    ? { evaluator_arrived_at: null, evaluation_status: "on_way" }
    : { evaluator_on_way_at: null, evaluation_status: "scheduled" };
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't undo that, try again." };
  revalidatePath("/me/full");
  return { ok: true };
}

/** The site map set-up, as answered so far. */
export async function saveVisitPlan(jobId: string, items: PlanItem[]): Promise<VisitResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const clean = readPlan(items).slice(0, 80);
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ evaluation_plan: clean }).eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't save that, try again." };
  revalidatePath(`/evaluate/${jobId}`);
  return { ok: true };
}

async function mayBookVisits() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) return null;
  return profile;
}

/**
 * Book (or move) a paid visit: the day and time, an hour long, in the
 * business's time zone. The visit is the account manager's unless the job
 * already has someone on it.
 */
export async function bookVisit(jobId: string, day: string, time: string): Promise<VisitResult> {
  const profile = await mayBookVisits();
  if (!profile) return { ok: false, message: "Only the account manager or the owner can book visits." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, message: "Pick a day and a time." };
  const start = zonedToUtc(day, time);
  const end = new Date(start.getTime() + 60 * 60_000);
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, assigned_to").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "Couldn't find that job." };
  const { error } = await supabase
    .from("jobs")
    .update({
      evaluation_date: start.toISOString(),
      evaluation_end_date: end.toISOString(),
      evaluation_status: "scheduled",
      evaluation_mode: "in_person",
      evaluator_on_way_at: null,
      evaluator_arrived_at: null,
      ...(job.assigned_to ? {} : { assigned_to: profile.id }),
    })
    .eq("id", jobId);
  if (error) {
    const busy = /busy|overlap|double|clash|conflict/i.test(error.message);
    return { ok: false, message: busy ? "Something else is booked then. Pick another time." : "Couldn't book that, try again." };
  }
  revalidatePath("/me");
  revalidatePath("/me/full");
  revalidateJobViews(jobId);
  return { ok: true };
}

/** The visit is done: walked, measured and ready to price. */
export async function finishVisit(jobId: string): Promise<VisitResult> {
  const profile = await mayBookVisits();
  if (!profile) return { ok: false, message: "Only the account manager or the owner can do that." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: job } = await supabase.from("jobs").select("evaluator_arrived_at, evaluator_on_way_at").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "Couldn't find that visit." };
  const { error } = await supabase
    .from("jobs")
    .update({ evaluation_status: "completed", evaluator_arrived_at: job.evaluator_arrived_at ?? now, evaluator_on_way_at: job.evaluator_on_way_at ?? now })
    .eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't save that, try again." };
  revalidatePath("/me");
  revalidatePath("/me/full");
  revalidateJobViews(jobId);
  return { ok: true };
}

/** Called off: the client cancelled or didn't answer. The lead goes back to "book another". */
export async function cancelVisit(jobId: string): Promise<VisitResult> {
  const profile = await mayBookVisits();
  if (!profile) return { ok: false, message: "Only the account manager or the owner can do that." };
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ evaluation_status: "cancelled" }).eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't save that, try again." };
  revalidatePath("/me");
  revalidatePath("/me/full");
  revalidateJobViews(jobId);
  return { ok: true };
}
