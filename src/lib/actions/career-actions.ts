"use server";

import { revalidatePath } from "next/cache";

import { checkTabAccess } from "@/lib/data/access";
import { getCareerProgress } from "@/lib/data/career";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getRealProfile } from "@/lib/data/team";
import {
  clampCount,
  parseStageNumber,
  reopenBlocker,
  signOffBlocker,
  stageByNumber,
} from "@/lib/career/stages";
import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";

export interface CareerActionResult {
  error?: string;
}

/**
 * Every change needs the Career Tracker permission, and nobody moves
 * themselves up the ladder unless they are an admin. The database says the
 * same thing (migration 0392); this is the readable version of the refusal.
 */
async function guard(profileId: string): Promise<{ error?: string; signerId?: string; organizationId?: string }> {
  const { allowed } = await checkTabAccess("career");
  if (!allowed) return { error: "You don't have access to the career tracker." };
  const me = await getRealProfile();
  if (!me) return { error: "Sign in first." };
  if (me.id === profileId && !me.roles.includes("admin")) {
    return { error: "Somebody else has to sign off your own stages." };
  }
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!member) return { error: "That team member isn't in this organization." };
  return { signerId: me.id, organizationId };
}

function refresh(profileId: string) {
  revalidatePath("/admin/career");
  revalidatePath(`/admin/career/${profileId}`);
}

async function upsert(
  organizationId: string,
  profileId: string,
  stage: number,
  values: { count?: number; note?: string | null; completed_at?: string | null; completed_by?: string | null }
): Promise<CareerActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("career_progress")
    .upsert({ organization_id: organizationId, profile_id: profileId, stage, ...values }, { onConflict: "profile_id,stage" });
  if (error) return { error: describeDbError(error, "Couldn't save that.") };
  refresh(profileId);
  return {};
}

/** Progress toward a stage's number: reviews, meetings, new hires mentored. */
export async function setStageCount(profileId: string, stageValue: number, countValue: number): Promise<CareerActionResult> {
  const stage = parseStageNumber(stageValue);
  const count = clampCount(countValue);
  if (!stage || count === null) return { error: "That isn't a stage or a number." };
  if (!stageByNumber(stage)?.target) return { error: "This stage has no number to count toward." };
  const ctx = await guard(profileId);
  if (ctx.error) return { error: ctx.error };
  const { progress } = await getCareerProgress(profileId);
  if (progress.find((p) => p.stage === stage)?.completed_at) {
    return { error: "Reopen the stage before changing its count." };
  }
  return upsert(ctx.organizationId!, profileId, stage, { count });
}

export async function signOffStage(profileId: string, stageValue: number, note: string): Promise<CareerActionResult> {
  const stage = parseStageNumber(stageValue);
  if (!stage) return { error: "That stage doesn't exist." };
  const ctx = await guard(profileId);
  if (ctx.error) return { error: ctx.error };
  const { progress } = await getCareerProgress(profileId);
  const blocker = signOffBlocker(stage, progress);
  if (blocker) return { error: blocker };
  return upsert(ctx.organizationId!, profileId, stage, {
    completed_at: new Date().toISOString(),
    completed_by: ctx.signerId!,
    note: note.trim() || null,
  });
}

/** Takes back the latest sign-off, keeping its count and note. */
export async function reopenStage(profileId: string, stageValue: number): Promise<CareerActionResult> {
  const stage = parseStageNumber(stageValue);
  if (!stage) return { error: "That stage doesn't exist." };
  const ctx = await guard(profileId);
  if (ctx.error) return { error: ctx.error };
  const { progress } = await getCareerProgress(profileId);
  const blocker = reopenBlocker(stage, progress);
  if (blocker) return { error: blocker };
  return upsert(ctx.organizationId!, profileId, stage, { completed_at: null, completed_by: null });
}
