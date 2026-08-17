"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { mergeableFields } from "@/lib/dedupe";

export type MergeResult = { ok: true; movedProperties: number } | { ok: false; message: string };

/**
 * Folds one contact into another.
 *
 * Properties move across — and everything hanging off them (jobs, canvas
 * designs, proposals, invoices, messages) travels with the property, so
 * nothing has to be rewritten job by job. Only then is the emptied contact
 * removed.
 *
 * Fields are filled, never overwritten: whatever the surviving contact already
 * has is what it keeps. A merge that silently replaced a corrected phone
 * number with an older one would be worse than the duplicate.
 *
 * Deliberately admin-only and never automatic. Merging live records is the one
 * operation here with no undo.
 */
export async function mergeContacts(keepId: string, mergeId: string): Promise<MergeResult> {
  try {
    if (!keepId || !mergeId) return { ok: false, message: "Pick both contacts." };
    if (keepId === mergeId) return { ok: false, message: "That's the same contact twice." };

    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can merge contacts." };
    }

    const supabase = await createClient();

    const { data: contacts, error: readError } = await supabase
      .from("customers")
      .select("id, name, email, phone, notes, account_manager_id")
      .in("id", [keepId, mergeId]);
    if (readError) return { ok: false, message: readError.message };

    const keep = contacts?.find((c) => c.id === keepId);
    const merge = contacts?.find((c) => c.id === mergeId);
    if (!keep || !merge) return { ok: false, message: "Couldn't find both contacts." };

    // Move the properties first. If this fails we've changed nothing, and the
    // duplicate is still intact.
    const { data: moved, error: moveError } = await supabase
      .from("properties")
      .update({ customer_id: keepId })
      .eq("customer_id", mergeId)
      .select("id");
    if (moveError) return { ok: false, message: moveError.message };

    const patch = mergeableFields(
      { email: keep.email ?? null, phone: keep.phone ?? null, notes: keep.notes ?? null },
      { email: merge.email ?? null, phone: merge.phone ?? null, notes: merge.notes ?? null }
    );
    // An account manager is a person, not a string, so it sits outside the
    // blank-filling helper.
    const accountManagerPatch =
      !keep.account_manager_id && merge.account_manager_id
        ? { account_manager_id: merge.account_manager_id }
        : {};

    if (Object.keys(patch).length > 0 || Object.keys(accountManagerPatch).length > 0) {
      const { error: patchError } = await supabase
        .from("customers")
        .update({ ...patch, ...accountManagerPatch })
        .eq("id", keepId);
      if (patchError) return { ok: false, message: patchError.message };
    }

    const { error: deleteError } = await supabase.from("customers").delete().eq("id", mergeId);
    if (deleteError) {
      return {
        ok: false,
        message: `Properties moved, but the duplicate couldn't be removed: ${deleteError.message}`,
      };
    }

    revalidatePath("/contacts");
    revalidatePath("/attractors");
    return { ok: true, movedProperties: moved?.length ?? 0 };
  } catch (err) {
    console.error("mergeContacts failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't merge those." };
  }
}
