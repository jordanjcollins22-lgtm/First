"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { CONTAINER_KINDS, parseKits } from "@/lib/kit-containers";

/**
 * Keeping the bins, and what to do when one breaks.
 *
 * The reason any of this is written down is the second half. A kit's container
 * is a thing that gets dropped off a tailgate, and until now the only record
 * of it was somebody remembering which crate cracked. Broken is a count on the
 * thing itself, so "two of the four crates are cracked" survives the drive
 * home.
 */

const KITS_PATH = "/admin/tools/kits";
const INVENTORY_PATH = "/admin/tools";

export type ContainerResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function refresh() {
  revalidatePath(KITS_PATH);
  revalidatePath(INVENTORY_PATH);
}

/** Make a container, or change one. */
export async function saveContainer(input: {
  id: string | null;
  name: string;
  kits: string;
  kind: string;
  quantity: string;
  cost: string;
  purchaseUrl: string;
  reorderThreshold: string;
  notes: string;
}): Promise<ContainerResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const name = input.name.trim();
  if (!name) return fail("Give it a name — the thing you would say out loud.");
  if (!CONTAINER_KINDS.some((k) => k.key === input.kind)) return fail("Say whether it was bought or built.");

  const quantity = numberOrNull(input.quantity);
  if (quantity !== null && quantity < 0) return fail("You can't have fewer than none of them.");

  const cost = numberOrNull(input.cost);
  if (cost !== null && cost < 0) return fail("A price can't be negative.");

  const reorderThreshold = numberOrNull(input.reorderThreshold);
  if (reorderThreshold !== null && reorderThreshold < 0) return fail("A reorder point can't be negative.");

  const row = {
    organization_id: profile.organization_id,
    name,
    kits: parseKits(input.kits),
    kind: input.kind,
    quantity: quantity === null ? null : Math.round(quantity),
    cost,
    purchase_url: input.purchaseUrl.trim() || null,
    reorder_threshold: reorderThreshold === null ? null : Math.round(reorderThreshold),
    notes: input.notes.trim().slice(0, 500) || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("kit_containers").update(row).eq("id", input.id);
    if (error) return fail(error.message);
    refresh();
    return { ok: true, value: { id: input.id } };
  }

  const { data, error } = await supabase.from("kit_containers").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Couldn't save that.");
  refresh();
  return { ok: true, value: { id: data.id } };
}

/**
 * Put a container away, or bring it back.
 *
 * Archived rather than deleted, because the parts hang off it and a rig that
 * fell apart last spring is still the answer to "what did we have that on".
 */
export async function archiveContainer(input: {
  id: string;
  archived: boolean;
}): Promise<ContainerResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("kit_containers")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.id);
  if (error) return fail(error.message);

  refresh();
  return { ok: true };
}

/** Add a part to a built rig, or change one. */
export async function savePart(input: {
  id: string | null;
  containerId: string;
  name: string;
  quantity: string;
  cost: string;
  purchaseUrl: string;
  position: number;
}): Promise<ContainerResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const name = input.name.trim();
  if (!name) return fail("What is the part called?");

  const quantity = numberOrNull(input.quantity) ?? 1;
  if (quantity <= 0) return fail("A setup takes at least one of it.");

  const cost = numberOrNull(input.cost);
  if (cost !== null && cost < 0) return fail("A price can't be negative.");

  const row = {
    organization_id: profile.organization_id,
    container_id: input.containerId,
    name,
    quantity: Math.round(quantity),
    cost,
    purchase_url: input.purchaseUrl.trim() || null,
    position: input.position,
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("kit_container_parts").update(row).eq("id", input.id);
    if (error) return fail(error.message);
    refresh();
    return { ok: true, value: { id: input.id } };
  }

  const { data, error } = await supabase.from("kit_container_parts").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Couldn't add that part.");
  refresh();
  return { ok: true, value: { id: data.id } };
}

/** Take a part off a rig. Deleted outright: a part nobody uses is noise. */
export async function removePart(input: { id: string }): Promise<ContainerResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase.from("kit_container_parts").delete().eq("id", input.id);
  if (error) return fail(error.message);

  refresh();
  return { ok: true };
}

/**
 * Say that something broke, or that it did not.
 *
 * A count rather than a flag, because two cracked crates and one cracked crate
 * are different orders. Ordering it clears nothing: the thing is still broken
 * until the replacement turns up, and a list that forgets it is a list that
 * gets it bought twice.
 */
export async function reportBroken(input: {
  containerId: string;
  partId: string | null;
  broken: number;
}): Promise<ContainerResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const broken = Math.max(0, Math.round(input.broken));
  const supabase = await createClient();

  const { error } = input.partId
    ? await supabase
        .from("kit_container_parts")
        .update({ broken, ...(broken === 0 ? { on_order: false } : {}) })
        .eq("id", input.partId)
    : await supabase
        .from("kit_containers")
        .update({ broken, ...(broken === 0 ? { on_order: false } : {}) })
        .eq("id", input.containerId);

  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

/** Mark a replacement ordered, or not ordered after all. */
export async function markOnOrder(input: {
  containerId: string;
  partId: string | null;
  onOrder: boolean;
}): Promise<ContainerResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = input.partId
    ? await supabase.from("kit_container_parts").update({ on_order: input.onOrder }).eq("id", input.partId)
    : await supabase.from("kit_containers").update({ on_order: input.onOrder }).eq("id", input.containerId);

  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
