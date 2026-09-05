"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { marketFor, type TargetMarket } from "@/lib/target-market";

export type MarketResult = { ok: true; message?: string } | { ok: false; message: string };

/** Splits whatever somebody typed or pasted into a list. Commas, newlines and
 * spaces all mean the same thing to a person entering zip codes. */
function toList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export async function saveTargetMarket(
  id: string | null,
  input: { name: string; zips: string; cities: string; counties: string; active: boolean }
): Promise<MarketResult> {
  try {
    if (!(await getCurrentProfile())?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can change the markets." };
    }
    const name = input.name.trim();
    if (!name) return { ok: false, message: "Give the market a name." };

    const zips = toList(input.zips);
    const cities = toList(input.cities);
    const counties = toList(input.counties);
    if (zips.length === 0 && cities.length === 0 && counties.length === 0) {
      return {
        ok: false,
        message: "Add at least one zip, town or county — otherwise it matches nothing.",
      };
    }

    const supabase = await createClient();
    const patch = { name, zips, cities, counties, active: input.active };

    if (id) {
      const { error } = await supabase.from("target_markets").update(patch).eq("id", id);
      if (error) return { ok: false, message: describeDbError(error) };
    } else {
      const organizationId = await getCurrentOrganizationId();
      const { error } = await supabase.from("target_markets").insert({ organization_id: organizationId, ...patch });
      if (error) return { ok: false, message: describeDbError(error) };
    }

    revalidatePath("/leads");
    return { ok: true, message: "Saved." };
  } catch (err) {
    console.error("saveTargetMarket failed:", err);
    return { ok: false, message: "Couldn't save that market." };
  }
}

export async function deleteTargetMarket(id: string): Promise<MarketResult> {
  try {
    if (!(await getCurrentProfile())?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can change the markets." };
    }
    const supabase = await createClient();
    const { error } = await supabase.from("target_markets").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/leads");
    return { ok: true, message: "Removed." };
  } catch {
    return { ok: false, message: "Couldn't remove that market." };
  }
}

export interface MarkResult {
  ok: true;
  inMarket: number;
  outOfMarket: number;
  unknown: number;
  message: string;
}

/**
 * Checks everybody against the markets and writes the answer down.
 *
 * Prospects and contacts both, because a bought parcel list and a CRM export
 * arrive with the same problem and it would be strange for one of them to know
 * where it is and the other not.
 *
 * Nothing is deleted and nothing is hidden. Out of market is a mark, and the
 * whole point of the mark is that somebody on the wrong side of the county
 * line still knows a neighbour on the right side of it.
 */
export async function markTargetMarkets(): Promise<MarkResult | { ok: false; message: string }> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();

    const { data: marketRows, error: marketError } = await supabase
      .from("target_markets")
      .select("id, name, zips, cities, counties, active");
    if (marketError) return { ok: false, message: describeDbError(marketError) };

    const markets = (marketRows ?? []) as unknown as TargetMarket[];
    if (markets.filter((m) => m.active).length === 0) {
      return { ok: false, message: "No active markets to check against — add one first." };
    }

    const [{ data: prospects }, { data: contacts }] = await Promise.all([
      supabase.from("lead_prospects").select("id, address, city, zip"),
      supabase.from("customers").select("id, import_address, properties(address)"),
    ]);

    let inMarket = 0;
    let outOfMarket = 0;
    let unknown = 0;

    const prospectUpdates: { id: string; value: boolean }[] = [];
    for (const row of (prospects ?? []) as unknown as {
      id: string;
      address: string | null;
      city: string | null;
      zip: string | null;
    }[]) {
      const verdict = marketFor({ address: row.address, city: row.city, zip: row.zip }, markets);
      if (!verdict.known) {
        unknown++;
        continue;
      }
      prospectUpdates.push({ id: row.id, value: verdict.inMarket });
      if (verdict.inMarket) inMarket++;
      else outOfMarket++;
    }

    const contactUpdates: { id: string; value: boolean }[] = [];
    for (const row of (contacts ?? []) as unknown as {
      id: string;
      import_address: string | null;
      properties: { address: string }[] | null;
    }[]) {
      // A real property's address beats the imported text: it is the one that
      // was good enough to geocode.
      const address = row.properties?.[0]?.address ?? row.import_address;
      const verdict = marketFor({ address, city: null, zip: null }, markets);
      if (!verdict.known) {
        unknown++;
        continue;
      }
      contactUpdates.push({ id: row.id, value: verdict.inMarket });
      if (verdict.inMarket) inMarket++;
      else outOfMarket++;
    }

    // Two statements per table rather than one per row: a county's worth of
    // parcels is tens of thousands of updates, and one at a time is an
    // afternoon.
    for (const value of [true, false]) {
      const prospectIds = prospectUpdates.filter((u) => u.value === value).map((u) => u.id);
      if (prospectIds.length > 0) {
        await supabase.from("lead_prospects").update({ in_target_market: value }).in("id", prospectIds);
      }
      const contactIds = contactUpdates.filter((u) => u.value === value).map((u) => u.id);
      if (contactIds.length > 0) {
        await supabase.from("customers").update({ in_target_market: value }).in("id", contactIds);
      }
    }

    revalidatePath("/leads");
    revalidatePath("/contacts");

    return {
      ok: true,
      inMarket,
      outOfMarket,
      unknown,
      message: `${inMarket.toLocaleString()} inside, ${outOfMarket.toLocaleString()} outside${
        unknown > 0 ? `, ${unknown.toLocaleString()} with no address to judge` : ""
      }.`,
    };
  } catch (err) {
    console.error("markTargetMarkets failed:", err);
    return { ok: false, message: "Couldn't check those against the markets." };
  }
}
