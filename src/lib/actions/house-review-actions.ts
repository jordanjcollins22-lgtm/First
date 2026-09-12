"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { normalizeAddress } from "@/lib/address-normalize";
import { assessAddress, NORMALIZER_VERSION } from "@/lib/address-quality";
import { looserTerms, rankHits, searchTerms } from "@/lib/address-search";
import { lookupAddress } from "@/lib/mapbox-geocoding";
import { firstAcceptable } from "@/lib/geocode-guard";

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
        // The corrected address is a house we already have, with its own
        // people or history. Then this held record is a duplicate of it --
        // a geocoder's second copy -- and the answer is to fold this one into
        // that one: every event, person, zone and hang moves across, nothing
        // is lost, and the duplicate goes.
        await mergeHouseInto(supabase, houseId, holder.id);
        revalidatePath(PAGE);
        return {
          message: `Merged into "${holder.address}", which already carried this house. Its people and history moved with it.`,
        };
      }
      if (existing.parcel_id && holder.parcel_id && existing.parcel_id !== holder.parcel_id) {
        throw new Error("This house is already linked to a different county parcel.");
      }
      const { error: dropError } = await supabase.from("houses").delete().eq("id", holder.id);
      if (dropError) throw dropError;
      absorbed = holder;
    }

    // Where the pin comes from, in order of trust: the county's row when
    // there is one; otherwise, if the pin we hold is the bad half, a fresh
    // lookup of the corrected address, checked against the region so that a
    // Peace Court in Queensland cannot come back a second time. Aberdeen
    // Proving Ground is the case: a federal installation the county does not
    // publish, so the county has no row to give and the geocoder has to.
    let coords: { lat: number | null; lng: number | null } = absorbed
      ? { lat: absorbed.lat, lng: absorbed.lng }
      : { lat: existing.lat, lng: existing.lng };
    let placedBy: string | null = absorbed ? "the county" : null;
    if (!absorbed) {
      const before = assessAddress(trimmed, coords);
      if (before.kind === "house" && before.needsReview) {
        const lookup = await lookupAddress(trimmed, undefined, { autocomplete: false });
        if (lookup.ok) {
          const { match } = firstAcceptable(trimmed, lookup.suggestions);
          if (match) {
            coords = { lat: match.lat, lng: match.lng };
            placedBy = match.fullAddress;
          }
        }
      }
    }
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
        ...(!absorbed && placedBy && coords.lat != null && coords.lng != null ? { lat: coords.lat, lng: coords.lng } : {}),
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
          ? `Corrected. Still held: ${verdict.reasons.join(". ")}${placedBy ? "" : " The county has no record of it and the map lookup found nothing to place it by."}`
          : placedBy
            ? `Corrected and placed at ${placedBy}. The county has no record of this address, so the pin is from a map lookup.`
            : "Corrected.",
    };
  });
}

export interface AddressHit {
  id: string;
  /** The address as its record writes it. */
  address: string;
  /** One of our own houses rather than a county row. Saving onto it merges. */
  ours: boolean;
}

/**
 * The addresses containing every word that was typed.
 *
 * Word by word rather than as one phrase, so "128 Post Rd Aberdeen" finds
 * "128 N POST RD, ABERDEEN, MD 21001" despite the N it lacks, and the words
 * may come in any order. County rows and our own houses both appear, marked
 * apart: picking a county row hands the held house the county's record and
 * pin; picking one of ours merges the held record into it, because a held
 * address that turns out to be a house we already have is a duplicate. When
 * every word together finds nothing, the number and the street name alone
 * are tried, so a mistyped town still gets a list to pick from.
 */
export async function searchAddresses(query: string, excludeHouseId: string): Promise<ActionResult<AddressHit[]>> {
  return guard("searchAddresses", async () => {
    await requireReviewer();
    const terms = searchTerms(query);
    if (terms.join("").length < 3) return [];

    const supabase = await createClient();
    const find = async (words: string[]) => {
      let q = supabase.from("houses").select("id, address, normalized_address, source").neq("id", excludeHouseId);
      for (const word of words) q = q.ilike("normalized_address", `%${word.replace(/[%_]/g, "")}%`);
      const { data, error } = await q.order("normalized_address").limit(20);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        address: row.address,
        normalized: row.normalized_address ?? "",
        ours: row.source !== "harford_gis",
      }));
    };

    let hits = await find(terms);
    if (hits.length === 0) {
      const loose = looserTerms(terms);
      if (loose.length > 0) hits = await find(loose);
    }
    return rankHits(hits, terms)
      .slice(0, 8)
      .map(({ id, address, ours }) => ({ id, address, ours }));
  });
}

/**
 * Folds one house into another and removes the first.
 *
 * Events and door hangs are re-pointed, since each is one row about one
 * house. People and zone memberships are pairs, so the ones the target
 * already has are skipped rather than doubled. The target keeps its own
 * property link unless it had none. The row being folded away is deleted
 * last, after everything on it has somewhere to live.
 */
async function mergeHouseInto(supabase: Awaited<ReturnType<typeof createClient>>, fromId: string, intoId: string) {
  const fail = (error: { message: string } | null) => {
    if (error) throw error;
  };

  fail((await supabase.from("property_events").update({ house_id: intoId }).eq("house_id", fromId)).error);
  fail((await supabase.from("door_hanger_events").update({ house_id: intoId }).eq("house_id", fromId)).error);

  const { data: contacts, error: contactsError } = await supabase
    .from("house_contacts")
    .select("customer_id, role")
    .eq("house_id", fromId);
  fail(contactsError);
  const { data: existingContacts } = await supabase.from("house_contacts").select("customer_id").eq("house_id", intoId);
  const has = new Set((existingContacts ?? []).map((c) => c.customer_id));
  const moving = (contacts ?? []).filter((c) => !has.has(c.customer_id));
  if (moving.length > 0) {
    fail(
      (await supabase.from("house_contacts").insert(moving.map((c) => ({ house_id: intoId, customer_id: c.customer_id, role: c.role }))))
        .error
    );
  }
  fail((await supabase.from("house_contacts").delete().eq("house_id", fromId)).error);

  const { data: zones } = await supabase.from("zone_houses").select("zone_id").eq("house_id", fromId);
  const { data: existingZones } = await supabase.from("zone_houses").select("zone_id").eq("house_id", intoId);
  const inZones = new Set((existingZones ?? []).map((z) => z.zone_id));
  const movingZones = (zones ?? []).filter((z) => !inZones.has(z.zone_id));
  if (movingZones.length > 0) {
    fail((await supabase.from("zone_houses").insert(movingZones.map((z) => ({ zone_id: z.zone_id, house_id: intoId })))).error);
  }
  fail((await supabase.from("zone_houses").delete().eq("house_id", fromId)).error);

  const { data: pair } = await supabase.from("houses").select("id, property_id").in("id", [fromId, intoId]);
  const from = pair?.find((h) => h.id === fromId);
  const into = pair?.find((h) => h.id === intoId);
  if (into && !into.property_id && from?.property_id) {
    fail((await supabase.from("houses").update({ property_id: from.property_id }).eq("id", intoId)).error);
  }

  fail((await supabase.from("houses").delete().eq("id", fromId)).error);
}
