import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { TargetMarket } from "@/lib/target-market";

export interface TargetMarketData {
  markets: TargetMarket[];
  /** Already marked as outside, across prospects and contacts both — so the
   * panel can report what the last check found rather than only offering to
   * run another one. */
  outOfMarket: number;
  setupNeeded: boolean;
}

export async function getTargetMarkets(): Promise<TargetMarketData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("target_markets")
    .select("id, name, zips, cities, counties, active")
    .order("name");

  if (isMissingTable(error)) return { markets: [], outOfMarket: 0, setupNeeded: true };
  if (error) throw error;

  const [{ count: prospectsOut }, { count: contactsOut }] = await Promise.all([
    supabase
      .from("lead_prospects")
      .select("id", { count: "exact", head: true })
      .eq("in_target_market", false),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("in_target_market", false),
  ]);

  return {
    markets: (data ?? []) as unknown as TargetMarket[],
    outOfMarket: (prospectsOut ?? 0) + (contactsOut ?? 0),
    setupNeeded: false,
  };
}
