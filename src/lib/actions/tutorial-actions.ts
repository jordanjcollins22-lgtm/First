"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getRealProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";

/** Records that the signed-in person finished (or skipped) a tour, so it doesn't open again. */
export async function markTourDone(tour: string): Promise<void> {
  const me = await getRealProfile();
  if (!me || !/^[a-z-]+-v\d+$/.test(tour)) return;
  const sb = (await createClient()) as unknown as SupabaseClient;
  await sb.from("tutorial_progress").upsert({ profile_id: me.id, tour, completed_at: new Date().toISOString() });
}
