"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { readShirtLine, type ShirtLine } from "@/lib/shirts";

type Result = { ok: true; id?: string } | { ok: false; message: string };

async function teamMember() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  return tabsAllowedForRoles(profile.roles, permissions).has("shirts") ? profile : null;
}

/** The order as filled in: every line checked, nothing sent anywhere. */
export async function placeShirtOrder(input: { lines: unknown[]; note: string }): Promise<Result> {
  const profile = await teamMember();
  if (!profile) return { ok: false, message: "Only someone with Company Shirts can order them." };
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 200).map(readShirtLine);
  if (lines.length === 0) return { ok: false, message: "Add at least one shirt." };
  if (lines.some((l) => l == null)) return { ok: false, message: "One of the shirts isn't one we make. Check its colour and size." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shirt_orders")
    .insert({ organization_id: profile.organization_id, lines: lines as ShirtLine[], note: input.note.trim().slice(0, 1000) || null, created_by: profile.id })
    .select("id")
    .single();
  if (error) return { ok: false, message: /shirt_orders/.test(error.message) ? "Shirt orders can't be saved until database update 0338 is applied." : "Couldn't save the order. Try again." };
  revalidatePath("/admin/shirts");
  return { ok: true, id: data.id };
}

/** Ordered from the printer, received, or cancelled. */
export async function setShirtOrderStatus(id: string, status: "ordered" | "received" | "cancelled" | "placed", printerNote?: string): Promise<Result> {
  const profile = await teamMember();
  if (!profile) return { ok: false, message: "Only someone with Company Shirts can change an order." };
  const now = new Date().toISOString();
  const supabase = await createClient();
  const patch: { status: string; ordered_at?: string | null; received_at?: string | null; printer_note?: string | null } = { status };
  if (status === "ordered") patch.ordered_at = now;
  if (status === "received") patch.received_at = now;
  if (status === "placed") Object.assign(patch, { ordered_at: null, received_at: null });
  if (printerNote !== undefined) patch.printer_note = printerNote.trim().slice(0, 1000) || null;
  const { error } = await supabase.from("shirt_orders").update(patch).eq("id", id).eq("organization_id", profile.organization_id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/admin/shirts");
  revalidatePath(`/admin/shirts/${id}`);
  return { ok: true };
}
