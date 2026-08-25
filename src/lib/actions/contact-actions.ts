"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Database } from "@/lib/supabase/database.types";
import { getCurrentProfile } from "@/lib/data/team";
import { mergeableFields } from "@/lib/dedupe";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import {
  canDeleteContact,
  cleanContact,
  looksLikeSamePerson,
  validateContact,
  type ContactInput,
} from "@/lib/contact-edit";

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

    // Every column, not just the ones the merge itself needs: the row is
    // about to be deleted, and what an undo will want back is all of it.
    const { data: contacts, error: readError } = await supabase
      .from("customers")
      .select("*")
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

    // Written before the delete, so a merge can never destroy a row without
    // the means to restore it existing first. If this insert fails the merge
    // stops here with the duplicate still intact — an un-undoable merge is
    // worse than a merge that did not happen.
    const { error: recordError } = await supabase.from("contact_merges").insert({
      organization_id: (merge as { organization_id: string }).organization_id,
      kept_id: keepId,
      kept_name: keep.name,
      merged_snapshot: merge as unknown as Record<string, unknown>,
      merged_name: merge.name,
      moved_property_ids: (moved ?? []).map((p) => (p as { id: string }).id),
      patched_fields: { ...patch, ...accountManagerPatch },
      merged_by: profile.id,
    });
    if (recordError) {
      return {
        ok: false,
        message: isMissingTable(recordError)
          ? "Merging needs its database migration first — run supabase/migrations/0091_contact_merge_undo.sql. Nothing was changed."
          : `Couldn't record the merge, so nothing was merged: ${recordError.message}`,
      };
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

export type ContactResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * Adds a contact.
 *
 * A person already in the book by the same email or number is not added twice
 * — their blanks are filled in from what was just typed and that record is
 * kept. That is the duplicate rule the rest of the app already follows, and
 * the alternative is a book with two of everybody.
 */
export async function createContact(input: ContactInput): Promise<ContactResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const clean = cleanContact(input);
    const verdict = validateContact(clean);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const { data: existing } = await supabase.from("customers").select("id, name, email, phone");
    const match = (
      (existing ?? []) as { id: string; name: string; email: string | null; phone: string | null }[]
    ).find((c) => looksLikeSamePerson(c, clean));

    if (match) {
      const patch = mergeableFields(
        { email: match.email, phone: match.phone },
        { email: clean.email, phone: clean.phone }
      );
      if (Object.keys(patch).length > 0) {
        await supabase.from("customers").update(patch).eq("id", match.id);
      }
      revalidatePath("/contacts");
      return {
        ok: true,
        message: `${match.name} is already in the book — filled in what was missing rather than adding a second.`,
      };
    }

    const { error } = await supabase.from("customers").insert({
      organization_id: organizationId,
      name: clean.name,
      email: clean.email,
      phone: clean.phone,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/contacts");
    revalidatePath("/attractors");
    return { ok: true, message: `${clean.name} added.` };
  } catch (err) {
    console.error("createContact failed:", err);
    return { ok: false, message: "Couldn't add that contact." };
  }
}

/** Changes a contact's details. */
export async function updateContact(id: string, input: ContactInput): Promise<ContactResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const clean = cleanContact(input);
    const verdict = validateContact(clean);
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const supabase = await createClient();
    const { error } = await supabase
      .from("customers")
      .update({ name: clean.name, email: clean.email, phone: clean.phone })
      .eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/contacts");
    revalidatePath(`/clients/${id}`);
    revalidatePath("/attractors");
    return { ok: true, message: "Saved." };
  } catch (err) {
    console.error("updateContact failed:", err);
    return { ok: false, message: "Couldn't save that." };
  }
}

/**
 * Removes a contact, if there is nothing behind them.
 *
 * Counted fresh rather than trusted from the page: properties cascade to jobs,
 * proposals, photos and messages, so a stale screen showing "0 properties"
 * must not be able to take a season of work with it.
 */
export async function deleteContact(id: string): Promise<ContactResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: properties } = await supabase.from("properties").select("id").eq("customer_id", id);
    const propertyIds = ((properties ?? []) as { id: string }[]).map((p) => p.id);

    let jobCount = 0;
    if (propertyIds.length > 0) {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .in("property_id", propertyIds);
      jobCount = count ?? 0;
    }

    const verdict = canDeleteContact({ propertyCount: propertyIds.length, jobCount });
    if (!verdict.ok) return { ok: false, message: verdict.reason };

    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath("/contacts");
    revalidatePath("/attractors");
    return { ok: true, message: "Contact removed." };
  } catch (err) {
    console.error("deleteContact failed:", err);
    return { ok: false, message: "Couldn't remove that contact." };
  }
}

/**
 * Puts a merged contact back.
 *
 * Three things happened and all three are reversed: the deleted row is
 * restored with its own id, the properties that changed hands go back, and
 * the blanks the merge filled on the keeper are emptied again.
 *
 * Restored with its original id on purpose. A new id would be a different
 * contact wearing the same name, and anything that had ever pointed at the old
 * one would still be pointing at nothing.
 *
 * The fields are only cleared if they still hold exactly what the merge put
 * there. Somebody may have corrected that phone number in the meantime, and an
 * undo that wipes a correction is a second mistake fixing the first.
 */
export async function undoContactMerge(mergeRecordId: string): Promise<ContactResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.roles.includes("admin")) {
      return { ok: false, message: "Only admins can undo a merge." };
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("contact_merges")
      .select("*")
      .eq("id", mergeRecordId)
      .maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };

    const record = data as unknown as {
      id: string;
      kept_id: string;
      merged_snapshot: Record<string, unknown>;
      merged_name: string;
      moved_property_ids: string[];
      patched_fields: Record<string, unknown>;
      undone_at: string | null;
    } | null;
    if (!record) return { ok: false, message: "Couldn't find that merge." };
    if (record.undone_at) return { ok: false, message: "That one has already been put back." };

    const snapshot = { ...record.merged_snapshot };
    const restoredId = snapshot.id as string | undefined;
    if (!restoredId) return { ok: false, message: "That merge has no record of what was deleted." };

    const { error: restoreError } = await supabase
      .from("customers")
      .insert(snapshot as unknown as Database["public"]["Tables"]["customers"]["Insert"]);
    if (restoreError) {
      return { ok: false, message: `Couldn't restore ${record.merged_name}: ${restoreError.message}` };
    }

    if (record.moved_property_ids.length > 0) {
      const { error: moveBackError } = await supabase
        .from("properties")
        .update({ customer_id: restoredId })
        .in("id", record.moved_property_ids);
      if (moveBackError) {
        return {
          ok: false,
          message: `${record.merged_name} is back, but their properties didn't move: ${moveBackError.message}`,
        };
      }
    }

    const clearable = Object.keys(record.patched_fields);
    if (clearable.length > 0) {
      const { data: keeper } = await supabase
        .from("customers")
        .select("*")
        .eq("id", record.kept_id)
        .maybeSingle();

      const current = (keeper ?? {}) as Record<string, unknown>;
      const revert: Record<string, null> = {};
      for (const field of clearable) {
        // Only if it still holds what the merge put there.
        if (current[field] === record.patched_fields[field]) revert[field] = null;
      }
      if (Object.keys(revert).length > 0) {
        await supabase
          .from("customers")
          .update(revert as Database["public"]["Tables"]["customers"]["Update"])
          .eq("id", record.kept_id);
      }
    }

    await supabase
      .from("contact_merges")
      .update({ undone_at: new Date().toISOString(), undone_by: profile.id })
      .eq("id", record.id);

    revalidatePath("/contacts");
    revalidatePath("/attractors");
    return { ok: true, message: `${record.merged_name} is back.` };
  } catch (err) {
    console.error("undoContactMerge failed:", err);
    return { ok: false, message: "Couldn't undo that merge." };
  }
}
