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
 * Nothing here deletes. A street with four hundred houses on it is still a
 * true thing about the county, and the door-hanger zones may yet want it.
 */

/** It is a house. Put it on the map. */
export async function acceptHouse(houseId: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

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

  revalidatePath("/admin/houses");
}

/**
 * It is not a house. Keep it, do not draw it.
 *
 * `needs_review` goes false because nobody needs to look again, but `kind`
 * stays whatever it is, so the map's rule -- a house that is not held -- keeps
 * it off without a second flag to forget about.
 */
export async function holdHouse(houseId: string, reason: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

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

  revalidatePath("/admin/houses");
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
 * Coordinates are deliberately left alone. They were the untrustworthy half,
 * and the county import is what fixes them.
 */
export async function correctHouseAddress(houseId: string, address: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const trimmed = address.trim();
  if (!trimmed) throw new Error("An address is needed.");

  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from("houses")
    .select("lat, lng")
    .eq("id", houseId)
    .maybeSingle();
  if (readError) throw readError;

  const verdict = assessAddress(trimmed, existing ?? null);

  const { error } = await supabase
    .from("houses")
    .update({
      address: trimmed,
      normalized_address: normalizeAddress(trimmed),
      address_normalizer_version: NORMALIZER_VERSION,
      kind: verdict.kind,
      needs_review: verdict.needsReview,
      review_reason: verdict.reasons.join(". ") || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile.id,
    })
    .eq("id", houseId);
  if (error) throw error;

  revalidatePath("/admin/houses");
}
