import { createClient } from "@/lib/supabase/server";

/**
 * The job the proposal square opens on: the latest proposal, on the panel
 * where it is built from the site map. So the square shows it as it is
 * really used, on real work, rather than the list it is reached from. Null
 * when there is none yet, and the square falls back to the list.
 */
export async function systemJobLinks(): Promise<{ proposal: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_proposals").select("job_id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { proposal: data ? `/jobs/${data.job_id}?open=proposal` : null };
}
