"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { refuseInDemo } from "@/lib/demo-mode";
import type { StepKind } from "@/lib/data/journey";

/**
 * Logging a new hire's journey: a check-in held, a review done, a training
 * phase signed off, the plan and culture gone through, their buddy. Anyone
 * with the Hiring tab can log; the person who logs it is recorded.
 */

type Result = { ok: true } | { ok: false; message: string };

const KINDS: readonly StepKind[] = ["checkin", "review", "training", "plan", "culture"];

async function trainer() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("hiring")) return null;
  return profile;
}

async function ownChecklist(sb: SupabaseClient, organizationId: string, id: string): Promise<boolean> {
  const { data } = await sb.from("onboarding_checklists").select("id").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  return !!data;
}

export async function logJourneyStep(input: { checklistId: string; kind: string; key: string; note?: string }): Promise<Result> {
  await refuseInDemo();
  const profile = await trainer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can log this." };
  if (!KINDS.includes(input.kind as StepKind) || !input.key || input.key.length > 80) return { ok: false, message: "That isn't a step we know." };
  const sb = createAdminClient() as unknown as SupabaseClient;
  if (!(await ownChecklist(sb, profile.organization_id, input.checklistId))) return { ok: false, message: "Couldn't find that new hire." };
  const { error } = await sb.from("new_hire_steps").upsert(
    {
      organization_id: profile.organization_id,
      checklist_id: input.checklistId,
      kind: input.kind,
      key: input.key,
      done_at: new Date().toISOString(),
      done_by: profile.id,
      done_by_name: profile.full_name || null,
      note: input.note?.trim().slice(0, 2000) || null,
    },
    { onConflict: "checklist_id,kind,key" }
  );
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath(`/admin/hiring/team/${input.checklistId}`);
  return { ok: true };
}

export async function undoJourneyStep(input: { checklistId: string; kind: string; key: string }): Promise<Result> {
  await refuseInDemo();
  const profile = await trainer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can change this." };
  const sb = createAdminClient() as unknown as SupabaseClient;
  const { error } = await sb
    .from("new_hire_steps")
    .delete()
    .eq("organization_id", profile.organization_id)
    .eq("checklist_id", input.checklistId)
    .eq("kind", input.kind)
    .eq("key", input.key);
  if (error) return { ok: false, message: "Couldn't undo that. Try again." };
  revalidatePath(`/admin/hiring/team/${input.checklistId}`);
  return { ok: true };
}

export async function setJourneyDetails(input: { checklistId: string; buddyName?: string | null; ownsChecklists?: boolean }): Promise<Result> {
  await refuseInDemo();
  const profile = await trainer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can change this." };
  const patch: Record<string, unknown> = {};
  if (input.buddyName !== undefined) patch.buddy_name = input.buddyName?.trim().slice(0, 120) || null;
  if (input.ownsChecklists !== undefined) patch.owns_checklists = !!input.ownsChecklists;
  const sb = createAdminClient() as unknown as SupabaseClient;
  const { error } = await sb.from("onboarding_checklists").update(patch).eq("organization_id", profile.organization_id).eq("id", input.checklistId);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath(`/admin/hiring/team/${input.checklistId}`);
  return { ok: true };
}
