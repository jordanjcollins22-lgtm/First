"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeDbError } from "@/lib/setup-errors";
import { generateCode, normaliseCode } from "@/lib/inventory-codes";

export type TrackingResult =
  | { ok: true; code?: string; message?: string }
  | { ok: false; message: string };

/**
 * Issues a code for something.
 *
 * Retried on a collision rather than trusted: six characters out of a
 * thirty-letter alphabet is plenty of room, but "plenty of room" is not the
 * same as none, and the one time it collides would be silent.
 */
export async function issueCode(input: {
  toolId?: string;
  materialId?: string;
  storageLocation?: string;
  label?: string;
  expectedQuantity?: number | null;
}): Promise<TrackingResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const subjects = [input.toolId, input.materialId, input.storageLocation].filter(Boolean).length;
    if (subjects !== 1) {
      return { ok: false, message: "A code points at one thing — a tool, a material, or a place." };
    }

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const { error } = await supabase.from("inventory_codes").insert({
        organization_id: organizationId,
        code,
        tool_id: input.toolId ?? null,
        material_id: input.materialId ?? null,
        storage_location: input.storageLocation ?? null,
        label: input.label?.trim() || null,
        expected_quantity: input.expectedQuantity ?? null,
        created_by: profile.id,
      });

      if (!error) {
        revalidatePath("/admin/tools");
        revalidatePath("/admin/labels");
        return { ok: true, code, message: `Code ${code} is ready to print.` };
      }
      // Only a duplicate is worth another go. Anything else is real.
      if (error.code !== "23505") return { ok: false, message: describeDbError(error) };
    }

    return { ok: false, message: "Couldn't find a free code — try again." };
  } catch (err) {
    console.error("issueCode failed:", err);
    return { ok: false, message: "Couldn't make that code." };
  }
}

/**
 * Records something leaving, coming back, or being counted.
 *
 * Two writes: the movement, which is what happened and is never edited, and
 * the stock figure on the item, which is what the rest of the app already
 * reads. The movement is the record — if they ever disagree, a count settles
 * it, because the shelf wins.
 */
export async function recordMovement(input: {
  code: string;
  direction: "out" | "in" | "count";
  quantity: number;
  jobId?: string | null;
  note?: string;
}): Promise<TrackingResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first — a movement needs a name on it." };

    if (!(input.quantity >= 0)) return { ok: false, message: "How many?" };

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    const { data: codeRow, error: codeError } = await supabase
      .from("inventory_codes")
      .select("id, tool_id, material_id")
      .eq("code", normaliseCode(input.code))
      .eq("active", true)
      .maybeSingle();

    if (codeError) return { ok: false, message: describeDbError(codeError) };
    if (!codeRow) return { ok: false, message: "That code is not on anything." };
    if (!codeRow.tool_id && !codeRow.material_id) {
      return { ok: false, message: "That label is on a place, not a thing — scan the item itself." };
    }

    const { error } = await supabase.from("inventory_movements").insert({
      organization_id: organizationId,
      tool_id: codeRow.tool_id,
      material_id: codeRow.material_id,
      code_id: codeRow.id,
      direction: input.direction,
      quantity: input.quantity,
      profile_id: profile.id,
      job_id: input.jobId ?? null,
      note: input.note?.trim() || null,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    const adjusted = await applyToStock(codeRow, input.direction, input.quantity);
    if (!adjusted.ok) return adjusted;

    revalidatePath(`/i/${normaliseCode(input.code)}`);
    revalidatePath("/admin/tools");

    return {
      ok: true,
      message:
        input.direction === "out"
          ? "Taken out — it is against your name now."
          : input.direction === "in"
            ? "Back on the shelf."
            : "Counted.",
    };
  } catch (err) {
    console.error("recordMovement failed:", err);
    return { ok: false, message: "Couldn't record that." };
  }
}

/** Keeps the stock figure the rest of the app reads in step with the ledger. */
async function applyToStock(
  codeRow: { tool_id: string | null; material_id: string | null },
  direction: "out" | "in" | "count",
  quantity: number
): Promise<TrackingResult> {
  const supabase = await createClient();
  const table = codeRow.tool_id ? "tools" : "materials";
  const column = codeRow.tool_id ? "quantity" : "quantity_on_hand";
  const id = codeRow.tool_id ?? codeRow.material_id!;

  const { data: current, error: readError } = await supabase
    .from(table)
    .select(column)
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, message: describeDbError(readError) };

  const existing = Number((current as Record<string, unknown> | null)?.[column] ?? 0);
  const next =
    direction === "count"
      ? quantity
      : direction === "out"
        ? existing - quantity
        : existing + quantity;

  const { error } = await supabase
    .from(table)
    .update({ [column]: Math.max(0, next) } as never)
    .eq("id", id);
  if (error) return { ok: false, message: describeDbError(error) };

  return { ok: true };
}
