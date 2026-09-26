import { createClient } from "@/lib/supabase/server";

/**
 * The job each tool square opens on: the latest site map drawn for the map,
 * the latest proposal for the proposal. So the square shows the tool as it
 * is really used, on real work, rather than the list it is reached from.
 * Null when there is none yet, and the square falls back to the list.
 */
export async function systemJobLinks(): Promise<{ map: string | null; proposal: string | null }> {
  const supabase = await createClient();
  const [designs, proposal] = await Promise.all([
    // The latest site map somebody actually drew on, not the latest booking,
    // which has an empty map until the evaluator is standing there.
    supabase.from("canvas_designs").select("job_id, zones").order("updated_at", { ascending: false }).limit(10),
    supabase.from("job_proposals").select("job_id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const drawn = (designs.data ?? []).find((d) => Array.isArray(d.zones) && d.zones.length > 0);
  return {
    map: drawn ? `/jobs/${drawn.job_id}?open=map` : null,
    proposal: proposal.data ? `/jobs/${proposal.data.job_id}?open=proposal` : null,
  };
}
