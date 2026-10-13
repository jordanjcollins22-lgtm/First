"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getRealProfile } from "@/lib/data/team";
import { markVisit, type VisitResult } from "@/lib/actions/evaluation-visit-actions";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import { canRunJobs } from "@/lib/roles";

/**
 * The evaluator's two taps from their home screen: On my way (with the
 * directions) and Start visit (I've arrived, and into the visit).
 *
 * Checked here rather than left to the row security alone: only somebody
 * who does evaluations, on a visit booked with them, or somebody who runs
 * the jobs. While the owner previews somebody else nothing is recorded:
 * the screen still opens, so the preview can be walked through.
 */
export async function evaluatorVisitStep(jobId: string, step: "on_way" | "arrived"): Promise<VisitResult & { recorded?: boolean }> {
  const [viewer, real] = await Promise.all([getCurrentProfile(), getRealProfile()]);
  if (!viewer || !real) return { ok: false, message: "Sign in first." };
  if (viewer.id !== real.id) return { ok: true, recorded: false };

  const runsJobs = canRunJobs(viewer.roles);
  if (!runsJobs && !canDoEvaluations(viewer.roles, viewer.does_evaluations)) {
    return { ok: false, message: "Only the evaluator can start this visit." };
  }
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "Couldn't find that visit." };
  if (!runsJobs && job.assigned_to !== viewer.id) return { ok: false, message: "This visit is booked with somebody else." };

  const result = await markVisit(jobId, step);
  return result.ok ? { ok: true, recorded: true } : result;
}
