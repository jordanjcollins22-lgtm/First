"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountManager } from "@/lib/affiliate-roles";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type HuddleResult = { ok: true; message: string } | { ok: false; error: string };

export interface HuddleNotes {
  goal: string;
  watchOuts: string;
  blockers: string;
  shoutOut: string;
}

/** Save what was typed on the huddle page for the day. The crews are left as they are. */
export async function saveHuddleNotes(day: string, notes: HuddleNotes): Promise<HuddleResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, error: "Only the account manager or the owner can change the team huddle." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "That day isn't valid." };

  const clip = (s: string) => s.trim().slice(0, 2000) || null;
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { error } = await sb.from("crew_huddles").upsert(
    {
      organization_id: profile.organization_id,
      day,
      goal: clip(notes.goal),
      watch_outs: clip(notes.watchOuts),
      blockers: clip(notes.blockers),
      shout_out: clip(notes.shoutOut),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,day" }
  );
  if (error) {
    return { ok: false, error: /crew_huddles/.test(error.message) ? "The team huddle table isn't set up yet (migration 0390)." : "That didn't save. Try again." };
  }
  revalidatePath("/huddle");
  return { ok: true, message: "Saved." };
}
