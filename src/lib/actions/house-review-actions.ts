"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { normalizeAddress } from "@/lib/address-normalize";
import { assessAddress, NORMALIZER_VERSION } from "@/lib/address-quality";

/**
 * Settling a held address.
 *
 * Three answers and no fourth: it is a house after all, it is not one, or the
 * address itself was wrong and here is the right one. Every one of them
 * records who decided and when, because a held address that quietly became a
 * house is indistinguishable from one that was never held.
 *
 * Nothing here deletes a house with history. A street with four hundred
 * houses on it is still a true thing about the county, and the door-hanger
 * zones may yet want it.
 *
 * Outcomes are returned, not thrown: in production a thrown server error
 * reaches the browser as React error #441 with its message removed.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGE = "/admin/houses";

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[house-review] ${name} failed:`, err);
    const e = err as { message?: string; details?: string; code?: string };
    return {
      ok: false,
      error: [e?.message, e?.details, e?.code ? `(${e.code})` : null].filter(Boolean).join(" ") || String(err),
    };
  }
}

async function requireReviewer() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile;
}

/** It is a house. Put it on the map. */
export async function acceptHouse(houseId: string): Promise<ActionResult<null>> {
  return guard("acceptHouse", async () => {
    const profile = await requireReviewer();
    const supabase = await createClient();
    const { error } = await supabase
      .from("houses")
      .update({
        kind: "house",
        needs_review: false,
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.id,
      })
      .eq("id", houseId);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

/**
 * It is not a house. Keep it, do not draw it.
 *
 * `needs_review` goes false because nobody needs to look again, but `kind`
 * stays whatever it is, so the map's rule -- a house that is not held -- keeps
 * it off without a second flag to forget about.
 */
export async function holdHouse(houseId: string, reason: string): Promise<ActionResult<null>> {
  return guard("holdHouse", async () => {
    const profile = await requireReviewer();
    const supabase = await createClient();
    const { error } = await supabase
      .from("houses")
      .update({
        needs_review: false,
        review_reason: reason.trim() || "Not a single house",
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.id,
      })
      .eq("id", houseId);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

/**
 * The address was wrong. Here is the right one.
 *
 * Re-keys and re-judges through the same functions the importer uses, so a
 * corrected address is indistinguishable from one that arrived correct. The
 * raw string is replaced here and only here: this is a person saying the
 * original was a mistake, which is the one case where keeping it would be
 * keeping a known error.
 *
 * With the county loaded, the corrected address usually already exists as a
 * county row with nothing on it -- the importer could not know it was ours.
 * That row is absorbed: its parcel, its pin and the county's spelling move
 * onto our house, and it is removed, so the key stays unique and the bad pin
 * is replaced by a good one. A row with history of its own is never absorbed;
 * that is a merge for a person.
 */
export async function correctHouseAddress(houseId: string, address: string): Promise<ActionResult<{ message: string }>> {
  return guard("correctHouseAddress", async () => {
    const profile = await requireReviewer();
    const trimmed = address.trim();
    if (!trimmed) throw new Error("An address is needed.");
    const normalized = normalizeAddress(trimmed);
    if (!normalized) throw new Error("That does not read as an address.");

    const supabase = await createClient();

    const { data: existing, error: readError } = await supabase
      .from("houses")
      .select("id, organization_id, lat, lng, parcel_id")
      .eq("id", houseId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) throw new Error("That house no longer exists.");

    // Whoever else already holds this key.
    const { data: holder, error: holderError } = await supabase
      .from("houses")
      .select(
        "id, address, source, parcel_id, county, lat, lng, owner_name, lot_size_sqft, gis_address, property_id, property_events(id), house_contacts(customer_id), zone_houses(zone_id)"
      )
      .eq("organization_id", existing.organization_id)
      .eq("normalized_address", normalized)
      .neq("id", houseId)
      .maybeSingle();
    if (holderError) throw holderError;

    let absorbed: typeof holder | null = null;
    if (holder) {
      const bare =
        holder.source === "harford_gis" &&
        !holder.property_id &&
        (holder.property_events?.length ?? 0) === 0 &&
        (holder.house_contacts?.length ?? 0) === 0 &&
        (holder.zone_houses?.length ?? 0) === 0;
      if (!bare) {
        throw new Error(`"${holder.address}" is already a house with history of its own. Merge those by hand first.`);
      }
      if (existing.parcel_id && holder.parcel_id && existing.parcel_id !== holder.parcel_id) {
        throw new Error("This house is already linked to a different county parcel.");
      }
      const { error: dropError } = await supabase.from("houses").delete().eq("id", holder.id);
      if (dropError) throw dropError;
      absorbed = holder;
    }

    const coords = absorbed ? { lat: absorbed.lat, lng: absorbed.lng } : existing;
    const verdict = assessAddress(trimmed, coords);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("houses")
      .update({
        address: trimmed,
        normalized_address: normalized,
        address_normalizer_version: NORMALIZER_VERSION,
        kind: verdict.kind,
        needs_review: verdict.needsReview,
        review_reason: verdict.reasons.join(". ") || null,
        reviewed_at: now,
        reviewed_by: profile.id,
        ...(absorbed
          ? {
              lat: absorbed.lat,
              lng: absorbed.lng,
              parcel_id: absorbed.parcel_id,
              county: absorbed.county,
              owner_name: absorbed.owner_name,
              lot_size_sqft: absorbed.lot_size_sqft,
              gis_address: absorbed.gis_address ?? absorbed.address,
              gis_matched_at: now,
              source_updated_at: now,
            }
          : {}),
      })
      .eq("id", houseId);
    if (error) throw error;

    revalidatePath(PAGE);
    return {
      message: absorbed
        ? "Corrected, and linked to the county's record of it, pin included."
        : verdict.needsReview
          ? `Corrected. Still held: ${verdict.reasons.join(". ")}`
          : "Corrected.",
    };
  });
}

export interface AddressHit {
  id: string;
  /** The county's address, as the county writes it. */
  address: string;
}

/**
 * The county's addresses that contain what was typed.
 *
 * Matched on the normalized key, so "barton ct abingdon" finds "102 BARTON
 * CT, ABINGDON, MD 21009" however either was spelled, and only among county
 * rows -- the point of the search is to hand a held house the county's
 * record of it, pin and all. A handful of results, ordered so a house number
 * typed first floats its street to the top.
 */
export async function searchCountyAddresses(query: string): Promise<ActionResult<AddressHit[]>> {
  return guard("searchCountyAddresses", async () => {
    await requireReviewer();
    const needle = normalizeAddress(query);
    if (needle.length < 3) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("houses")
      .select("id, address, normalized_address")
      .eq("source", "harford_gis")
      .not("parcel_id", "is", null)
      .ilike("normalized_address", `%${needle.replace(/[%_]/g, "")}%`)
      .order("normalized_address")
      .limit(8);
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id, address: row.address }));
  });
}
