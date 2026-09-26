import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { sdatLink } from "@/lib/house-facts";
import { parseSdatOwner } from "@/lib/sdat-owner";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Who owns one house, by name.
 *
 * The open-data roll withholds owners' names, so the first time a house
 * is asked about the State's property-record page for its account is
 * read and the name kept beside the house. Every later ask is answered
 * from what was kept. The page also says where the tax bill goes and
 * whether the owner calls it their principal residence, which settles
 * owner-or-renter for a house the roll left unknown.
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 9_000;

export async function GET(_request: NextRequest, context: { params: Promise<{ houseId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { houseId } = await context.params;
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("house_ownership")
    .select("account_id, owner_name, owner_mailing, owner_occupied, occupancy_reason")
    .eq("house_id", houseId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ ownerName: null, mailing: null, reason: "Not on the State's roll." }, { headers: { "cache-control": "no-store" } });
  if (row.owner_name) {
    return NextResponse.json({ ownerName: row.owner_name, mailing: row.owner_mailing, ownerOccupied: row.owner_occupied }, { headers: { "cache-control": "no-store" } });
  }

  const url = sdatLink(row.account_id);
  if (!url) return NextResponse.json({ ownerName: null, mailing: null, reason: "No account number to look up." }, { headers: { "cache-control": "no-store" } });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ ownerName: null, mailing: null, reason: `The State's page answered ${res.status}.` }, { headers: { "cache-control": "no-store" } });
    html = await res.text();
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError" ? "The State's page took too long." : "The State's page did not answer.";
    return NextResponse.json({ ownerName: null, mailing: null, reason: message }, { headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }

  const owner = parseSdatOwner(html);
  if (!owner || !owner.ownerName) {
    return NextResponse.json({ ownerName: null, mailing: owner?.mailing ?? null, reason: "The State's page had no owner on it." }, { headers: { "cache-control": "no-store" } });
  }

  // Keep it, and let what the page says settle owner-or-renter where the
  // roll could not.
  const patch: Database["public"]["Tables"]["house_ownership"]["Update"] = { owner_name: owner.ownerName };
  if (owner.mailing && !row.owner_mailing) patch.owner_mailing = owner.mailing;
  if (row.owner_occupied == null && owner.principalResidence != null) {
    patch.owner_occupied = owner.principalResidence;
    patch.occupancy_reason = owner.principalResidence ? "Owner claims it as principal residence" : "Not the owner's principal residence";
    patch.principal_residence = owner.principalResidence;
  }
  const { error: saveError } = await supabase.from("house_ownership").update(patch).eq("house_id", houseId).eq("organization_id", profile.organization_id);
  if (saveError) console.error("[owner] could not keep the owner's name:", saveError.message);

  return NextResponse.json(
    { ownerName: owner.ownerName, mailing: owner.mailing ?? row.owner_mailing, ownerOccupied: patch.owner_occupied ?? row.owner_occupied },
    { headers: { "cache-control": "no-store" } }
  );
}
