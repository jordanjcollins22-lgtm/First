"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { followUpNote } from "@/lib/proposal-outcome";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type FollowUpResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Mark a follow-up done, with what happened. The note is kept on the task
 * under what it said before, so the owner can read how it went.
 */
export async function finishFollowUp(id: string, happened: string): Promise<FollowUpResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can do this." };
  }
  const what = happened.trim();
  if (what.length < 3) return { ok: false, error: "Say what happened." };

  // owner_tasks is not in the generated types yet.
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: task } = await sb.from("owner_tasks").select("id, note, status, organization_id").eq("id", id).maybeSingle();
  if (!task || task.organization_id !== profile.organization_id) return { ok: false, error: "That follow-up isn't there any more." };
  if (task.status === "done" || task.status === "dropped") return { ok: false, error: "This one is already done." };

  const now = new Date();
  const { error } = await sb
    .from("owner_tasks")
    .update({ status: "done", done_at: now.toISOString(), done_by: profile.id, updated_by: profile.id, updated_at: now.toISOString(), note: followUpNote(task.note, what, now) })
    .eq("id", id);
  if (error) return { ok: false, error: "That didn't go through. Try again." };

  revalidatePath("/me");
  return { ok: true, message: "Done." };
}
