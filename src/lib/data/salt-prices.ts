import { createClient } from "@/lib/supabase/server";
import { saltPriceList, saltSettingsFrom, type SaltPriceRow } from "@/lib/salt";

/**
 * The residential salting prices the account manager quotes, off the
 * organisation's own salt settings: the owner's set price per application
 * where there is one, otherwise the price worked out from cost.
 *
 * Every column is read, not a list of them, so the page still loads before
 * the set-price columns exist; until then every row is worked out.
 */
export async function loadSaltPrices(organizationId: string): Promise<SaltPriceRow[]> {
  const sb = await createClient();
  const { data } = await sb.from("organizations").select("*").eq("id", organizationId).maybeSingle();
  return saltPriceList(saltSettingsFrom((data ?? null) as Record<string, unknown> | null));
}
