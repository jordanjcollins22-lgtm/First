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

export interface SameHouseOutcome {
  linked: boolean;
  message: string;
  /**
   * Set when our house already carries a different county parcel. That
   * happens when our address, as written, matched a different county record
   * exactly -- "4019 Federal Hill Rd" when the house is on Old Federal Hill
   * Rd. The person then has to say which address is right; see relinkToCounty.
   */
  conflict?: { currentGisAddress: string | null };
}

/** It is the same house. Link the county's parcel to it. */
export async function settleAsSameHouse(reviewId: string): Promise<ActionResult<SameHouseOutcome>> {
  return guard("settleAsSameHouse", async () => {
    const profile = await requireReviewer();
    const { admin, review } = await loadPending(reviewId);
    if (!review.parcel_id || !review.incoming_address) {
      throw new Error("This question has no parcel on it to link.");
    }

    const { data: ours } = await admin
      .from("houses")
      .select("parcel_id, gis_address")
      .eq("id", review.house_id)
      .maybeSingle();
    if (ours?.parcel_id && ours.parcel_id !== review.parcel_id) {
      return {
        linked: false,
        message: `This house is already linked to the county's "${ours.gis_address ?? ours.parcel_id}", because our address matched it exactly. If the house is really at the county's other address, our address was wrong: take the county's below.`,
        conflict: { currentGisAddress: ours.gis_address ?? null },
      };
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
      throw new Error("That county parcel is already on another house.");
    }
    if (outcome === "error") throw new Error("The house could not be updated.");

    await markSettled(admin, reviewId, "same_house", profile.id);
    revalidatePath(PAGE);
    return { linked: true, message: "Linked." };
  });
}

async function markSettled(
  admin: ReturnType<typeof createAdminClient>,
  reviewId: string,
  resolution: "same_house" | "different",
  reviewerId: string,
  createdHouseId: string | null = null
) {
  const { error } = await admin
    .from("house_match_reviews")
    .update({
      status: resolution === "same_house" ? "accepted" : "rejected",
      resolution,
      created_house_id: createdHouseId,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (error) throw error;
}

/**
 * Same house, and our address was the wrong one.
 *
 * The house takes the county's address as its own -- the one place the raw
 * address is rewritten, because a person has said the original was a mistake
 * -- and the county's parcel. The parcel it wrongly held is released, and a
 * note is left so the next import creates that county record as its own
 * house instead of asking about it. If the review kept the parcel's pin the
 * house moves to it now; otherwise the house is held until the next import
 * brings the pin, which the importer does for any held house it finds linked.
 */
export async function relinkToCounty(reviewId: string): Promise<ActionResult<{ message: string }>> {
  return guard("relinkToCounty", async () => {
    const profile = await requireReviewer();
    const { admin, review } = await loadPending(reviewId);
    if (!review.parcel_id || !review.incoming_address) {
      throw new Error("This question has no parcel on it to link.");
    }

    const { data: ours, error: oursError } = await admin
      .from("houses")
      .select("id, parcel_id, gis_address, normalized_address")
      .eq("id", review.house_id)
      .maybeSingle();
    if (oursError) throw oursError;
    if (!ours) throw new Error("That house no longer exists.");

    // Someone else may already hold the county's key as a bare row.
    const normalized = review.incoming_normalized ?? normalizeAddress(review.incoming_address);
    const { data: holder } = await admin
      .from("houses")
      .select("id, source, property_id, property_events(id), house_contacts(customer_id), zone_houses(zone_id)")
      .eq("organization_id", review.organization_id)
      .eq("normalized_address", normalized)
      .neq("id", ours.id)
      .maybeSingle();
    if (holder) {
      const bare =
        holder.source === "harford_gis" &&
        !holder.property_id &&
        (holder.property_events?.length ?? 0) === 0 &&
        (holder.house_contacts?.length ?? 0) === 0 &&
        (holder.zone_houses?.length ?? 0) === 0;
      if (!bare) throw new Error("The county's address is already a house with history of its own. Merge those by hand first.");
      const { error } = await admin.from("houses").delete().eq("id", holder.id);
      if (error) throw error;
    }

    // Release the parcel we held by mistake, and make sure it comes back as
    // its own house rather than as a question.
    if (ours.parcel_id && ours.parcel_id !== review.parcel_id && ours.gis_address) {
      await admin.from("house_match_reviews").insert({
        organization_id: review.organization_id,
        house_id: ours.id,
        score: 0.8,
        status: "rejected",
        resolution: "different",
        incoming_address: ours.gis_address,
        incoming_normalized: normalizeAddress(ours.gis_address),
        parcel_id: ours.parcel_id,
        source: "harford_gis",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      });
    }

    const hasPin = review.incoming_lat != null && review.incoming_lng != null;
    const now = new Date().toISOString();
    const { error } = await admin
      .from("houses")
      .update({
        address: review.incoming_address,
        normalized_address: normalized,
        address_normalizer_version: NORMALIZER_VERSION,
        parcel_id: review.parcel_id,
        county: "Harford",
        gis_address: review.incoming_address,
        gis_matched_at: now,
        source_updated_at: now,
        kind: "house",
        ...(hasPin
          ? { lat: review.incoming_lat!, lng: review.incoming_lng!, needs_review: false, review_reason: null }
          : { lat: 0, lng: 0, needs_review: true, review_reason: "Waiting for the county's pin for the corrected address" }),
        reviewed_at: now,
        reviewed_by: profile.id,
        updated_at: now,
      })
      .eq("id", ours.id);
    if (error) throw error;

    await markSettled(admin, reviewId, "same_house", profile.id);
    revalidatePath(PAGE);
    return {
      message: hasPin
        ? "Relinked: the house now carries the county's address, parcel and pin."
        : "Relinked to the county's address and parcel. Its pin arrives with the next county import.",
    };
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

    await markSettled(admin, reviewId, "different", profile.id, createdHouseId);
    revalidatePath(PAGE);
    return { message };
  });
}
