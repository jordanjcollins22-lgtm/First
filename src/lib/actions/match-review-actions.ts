"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { enrichHouse } from "@/lib/gis-import-run";
import { normalizeAddress } from "@/lib/address-normalize";
import { assessAddress, NORMALIZER_VERSION } from "@/lib/address-quality";

/**
 * Answering the county's near-match questions.
 *
 * Two answers and no third. "Same house" links the parcel to the house we
 * hold, exactly as the importer would have had the addresses been identical:
 * the raw address stays, the county's fields arrive, the events are not
 * touched. "Different house" makes the county's address a house of its own,
 * with the pin the county gave it, and records the answer so the importer
 * never asks about that parcel against that house again.
 *
 * Returned rather than thrown: a thrown server error reaches a production
 * browser as React error #441 with its message stripped.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGE = "/admin/houses";

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[match-review] ${name} failed:`, err);
    const e = err as { message?: string; details?: string; code?: string };
    return { ok: false, error: [e?.message, e?.details, e?.code ? `(${e.code})` : null].filter(Boolean).join(" ") || String(err) };
  }
}

async function requireReviewer() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  if (!isSupabaseAdminConfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  return profile;
}

async function loadPending(reviewId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("house_match_reviews")
    .select("id, organization_id, house_id, parcel_id, incoming_address, incoming_normalized, incoming_lat, incoming_lng, status")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That question no longer exists.");
  if (data.status !== "pending") throw new Error("That question was already answered.");
  return { admin, review: data };
}

/** It is the same house. Link the county's parcel to it. */
export async function settleAsSameHouse(reviewId: string): Promise<ActionResult<{ message: string }>> {
  return guard("settleAsSameHouse", async () => {
    const profile = await requireReviewer();
    const { admin, review } = await loadPending(reviewId);
    if (!review.parcel_id || !review.incoming_address) {
      throw new Error("This question has no parcel on it to link.");
    }

    // The county's row may already exist as a house of its own, made before
    // anyone could say it was ours. If it carries nothing -- no events, no
    // people, no zone -- it is absorbed: removed, and its parcel moved onto
    // our house. If it carries anything, that is a merge for a person to do.
    const { data: holder } = await admin
      .from("houses")
      .select("id, source, property_id, property_events(id), house_contacts(customer_id), zone_houses(zone_id)")
      .eq("organization_id", review.organization_id)
      .eq("county", "Harford")
      .eq("parcel_id", review.parcel_id)
      .neq("id", review.house_id)
      .maybeSingle();
    if (holder) {
      const bare =
        holder.source === "harford_gis" &&
        !holder.property_id &&
        (holder.property_events?.length ?? 0) === 0 &&
        (holder.house_contacts?.length ?? 0) === 0 &&
        (holder.zone_houses?.length ?? 0) === 0;
      if (!bare) {
        throw new Error("The county's address is already a house with history of its own. Merge those by hand first.");
      }
      const { error: dropError } = await admin.from("houses").delete().eq("id", holder.id);
      if (dropError) throw dropError;
    }

    const outcome = await enrichHouse(admin, review.house_id, {
      parcelId: review.parcel_id,
      address: review.incoming_address,
      lat: review.incoming_lat,
      lng: review.incoming_lng,
      ownerName: null,
      lotSizeSqft: null,
    });
    if (outcome === "duplicate-link") {
      throw new Error("That house is already linked to a different county parcel, so this one cannot be the same house.");
    }
    if (outcome === "error") throw new Error("The house could not be updated.");

    const { error } = await admin
      .from("house_match_reviews")
      .update({
        status: "accepted",
        resolution: "same_house",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    if (error) throw error;

    revalidatePath(PAGE);
    return { message: "Linked." };
  });
}

/**
 * It is a different house. Make it one.
 *
 * With the parcel's pin on the review the house is created here and now.
 * Without one -- the questions raised before pins were kept -- the answer is
 * recorded and the next import run creates it, because a rejected question
 * turns that parcel into new ground.
 */
export async function settleAsDifferent(reviewId: string): Promise<ActionResult<{ message: string }>> {
  return guard("settleAsDifferent", async () => {
    const profile = await requireReviewer();
    const { admin, review } = await loadPending(reviewId);

    let createdHouseId: string | null = null;
    let message = "Recorded. The next county import will create it.";

    if (review.incoming_address && review.incoming_lat != null && review.incoming_lng != null) {
      const normalized = review.incoming_normalized ?? normalizeAddress(review.incoming_address);
      const verdict = assessAddress(review.incoming_address, { lat: review.incoming_lat, lng: review.incoming_lng });
      const now = new Date().toISOString();
      const { data: created, error } = await admin
        .from("houses")
        .upsert(
          {
            organization_id: review.organization_id,
            address: review.incoming_address,
            lat: review.incoming_lat,
            lng: review.incoming_lng,
            parcel_id: review.parcel_id,
            county: "Harford",
            source: "harford_gis",
            source_updated_at: now,
            normalized_address: normalized,
            address_normalizer_version: NORMALIZER_VERSION,
            kind: verdict.kind,
            needs_review: false,
            review_reason: null,
            gis_address: review.incoming_address,
            gis_matched_at: now,
          },
          { onConflict: "organization_id,normalized_address", ignoreDuplicates: true }
        )
        .select("id");
      if (error) throw error;
      createdHouseId = created?.[0]?.id ?? null;
      message = createdHouseId ? "Added as its own house." : "Recorded. A house with that address already exists.";
    }

    const { error } = await admin
      .from("house_match_reviews")
      .update({
        status: "rejected",
        resolution: "different",
        created_house_id: createdHouseId,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    if (error) throw error;

    revalidatePath(PAGE);
    return { message };
  });
}
