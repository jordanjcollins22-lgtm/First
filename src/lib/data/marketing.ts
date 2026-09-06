import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { MarketingPlay } from "@/lib/marketing-plays";

/**
 * The marketing plays, made by the database from evaluations and clients.
 *
 * Read with a sync first, so a client who paid a minute ago is on the list
 * when the page opens rather than after the next five-minute tick.
 */
export async function listMarketingPlays(options: { sync?: boolean; includeDone?: boolean } = {}): Promise<MarketingPlay[]> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (options.sync !== false) {
    const { error } = await supabase.rpc("marketing_sync_and_refresh", { org });
    if (error) console.error("[marketing] sync failed:", error.message);
  }
  const { data, error } = await supabase.rpc("marketing_plays_list", { org, include_done: options.includeDone !== false });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as MarketingPlay[];
}
