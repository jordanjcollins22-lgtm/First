"use server";

import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { hasRole, isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateKeyIn } from "@/lib/time-zone";
import { statusAfterReceiving, type PoStatus } from "@/lib/purchasing/takeoff";
import {
  buildTakeoffForJob,
  loadPurchasingSettings,
  raiseReorders,
  receiveLines,
  sendPurchaseOrder,
  settleOnOrderFlags,
  untyped,
} from "@/lib/data/purchasing";

/**
 * What the Purchasing panel can do. Settings are the owner's; running the
 * orders (approve, send, receive) is the owner's or a project lead's,
 * because materials on site are the lead's call and the point of all this is
 * that the owner stops being the one who phones the yard.
 *
 * Writes use the service role after the caller is checked, and every query
 * is pinned to the caller's organisation.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const PATH = "/v2/operations";

async function caller(options: { ownerOnly?: boolean } = {}) {
  const me = await getRealProfile();
  if (!me) return { error: "Not signed in." } as const;
  const owner = isOwnerLevel(me.roles);
  if (options.ownerOnly ? !owner : !owner && !hasRole(me.roles, "project-lead")) {
    return { error: options.ownerOnly ? "Only the owner can change this." : "Only the owner or a project lead can do this." } as const;
  }
  return { me, sb: untyped(createAdminClient()) } as const;
}

function done(message?: string): ActionResult {
  revalidatePath(PATH);
  return { ok: true, message };
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

export interface PurchasingSettingsPatch {
  takeoffEnabled?: boolean;
  reorderEnabled?: boolean;
  autoSendEnabled?: boolean;
  autoApproveUnderDollars?: number;
  notifyLead?: boolean;
  inHandDaysBefore?: number;
}

/**
 * Saves the switches. Turning one on for the first time stamps when, and the
 * stamp is never moved afterwards: switching off and on again does not make
 * the automation reach back over what happened in between.
 */
export async function savePurchasingSettings(patch: PurchasingSettingsPatch): Promise<ActionResult> {
  const c = await caller({ ownerOnly: true });
  if ("error" in c) return { ok: false, error: c.error! };
  const { me, sb } = c;
  const { data: current, error: readError } = await sb.from("purchasing_settings").select("*").eq("organization_id", me.organization_id).maybeSingle();
  if (readError) return { ok: false, error: "The purchasing tables aren't set up yet (migration 0360)." };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { organization_id: me.organization_id, updated_at: now, updated_by: me.id };
  const stamp = (flag: keyof PurchasingSettingsPatch, column: string, startedColumn: string) => {
    if (patch[flag] === undefined) return;
    row[column] = Boolean(patch[flag]);
    if (patch[flag] && !current?.[startedColumn]) row[startedColumn] = now;
  };
  stamp("takeoffEnabled", "takeoff_enabled", "takeoff_started_at");
  stamp("reorderEnabled", "reorder_enabled", "reorder_started_at");
  stamp("autoSendEnabled", "auto_send_enabled", "auto_send_started_at");
  if (patch.autoApproveUnderDollars !== undefined) {
    const dollars = Number(patch.autoApproveUnderDollars);
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100000) return { ok: false, error: "Auto-approve limit must be between $0 and $100,000." };
    row.auto_approve_under_cents = Math.round(dollars * 100);
  }
  if (patch.notifyLead !== undefined) row.notify_lead = Boolean(patch.notifyLead);
  if (patch.inHandDaysBefore !== undefined) {
    const days = Math.round(Number(patch.inHandDaysBefore));
    if (!Number.isFinite(days) || days < 0 || days > 30) return { ok: false, error: "Days before must be between 0 and 30." };
    row.in_hand_days_before = days;
  }
  const { error } = await sb.from("purchasing_settings").upsert(row);
  if (error) return { ok: false, error: "Couldn't save the settings." };
  return done("Saved.");
}

/* -------------------------------------------------------------------------
 * Orders
 * ---------------------------------------------------------------------- */

async function orderOf(sb: ReturnType<typeof untyped>, organizationId: string, id: string) {
  const { data } = await sb.from("purchase_orders").select("id, status, approved_at, supplier_id").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  return data as { id: string; status: PoStatus; approved_at: string | null; supplier_id: string | null } | null;
}

export async function approvePurchaseOrder(id: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (order.status !== "draft") return { ok: false, error: "Only a draft can be approved." };
  if (!order.supplier_id) return { ok: false, error: "Pick a supplier first." };
  await c.sb.from("purchase_orders").update({ approved_at: new Date().toISOString(), approved_by: c.me.id, updated_at: new Date().toISOString() }).eq("id", id);
  return done("Approved.");
}

export async function setPurchaseOrderSupplier(id: string, supplierId: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (order.status !== "draft") return { ok: false, error: "The supplier can only change on a draft." };
  const { data: supplier } = await c.sb.from("material_suppliers").select("id").eq("id", supplierId).eq("organization_id", c.me.organization_id).maybeSingle();
  if (!supplier) return { ok: false, error: "That supplier isn't one of ours." };
  // A new supplier means a new decision: the approval goes with the old one.
  await c.sb.from("purchase_orders").update({ supplier_id: supplierId, approved_at: null, auto_approved: false, updated_at: new Date().toISOString() }).eq("id", id);
  return done("Supplier set.");
}

export async function sendPurchaseOrderNow(id: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const result = await sendPurchaseOrder(c.sb, c.me.organization_id, id);
  if (!result.ok) {
    revalidatePath(PATH);
    return { ok: false, error: result.message };
  }
  return done(`Sent by ${result.via === "gmail" ? "Gmail" : "email"}.`);
}

/** Phoned in or ordered on the yard's website: recorded as sent without an email. */
export async function markPurchaseOrderSentByHand(id: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (order.status !== "draft") return { ok: false, error: "That order has already gone." };
  const now = new Date().toISOString();
  await c.sb
    .from("purchase_orders")
    .update({ status: "sent", sent_at: now, sent_via: "by hand", approved_at: order.approved_at ?? now, approved_by: c.me.id, send_error: null, updated_at: now })
    .eq("id", id)
    .eq("status", "draft");
  return done("Marked as ordered.");
}

export async function markPurchaseOrderConfirmed(id: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (order.status !== "sent") return { ok: false, error: "Only a sent order can be confirmed." };
  await c.sb.from("purchase_orders").update({ status: "confirmed", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  return done("Confirmed.");
}

/**
 * Records what came. Each received quantity is added to the shelf, and the
 * order becomes partial until every line is in.
 */
export async function receivePurchaseOrder(input: {
  id: string;
  mode: "delivered" | "picked_up";
  lines: { lineId: string; quantity: number }[];
}): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, input.id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (!["sent", "confirmed", "partial", "draft"].includes(order.status)) return { ok: false, error: "That order is already closed." };
  const lines = input.lines.filter((l) => Number.isFinite(l.quantity) && l.quantity > 0 && l.quantity < 100000);
  if (lines.length === 0) return { ok: false, error: "Enter how much came." };

  const { lines: after } = await receiveLines(c.sb, c.me.organization_id, input.id, lines, c.me.id);
  const status = statusAfterReceiving(after, input.mode);
  const now = new Date().toISOString();
  await c.sb
    .from("purchase_orders")
    .update({ status, received_at: status === "partial" ? null : now, updated_at: now })
    .eq("id", input.id);
  const { data: materialRows } = await c.sb.from("purchase_order_lines").select("material_id").eq("purchase_order_id", input.id);
  await settleOnOrderFlags(c.sb, c.me.organization_id, ((materialRows ?? []) as { material_id: string | null }[]).map((r) => r.material_id).filter(Boolean) as string[]);
  return done(status === "partial" ? "Part received. The rest is still expected." : "Received and added to stock.");
}

export async function cancelPurchaseOrder(id: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const order = await orderOf(c.sb, c.me.organization_id, id);
  if (!order) return { ok: false, error: "That order isn't there any more." };
  if (["delivered", "picked_up", "cancelled"].includes(order.status)) return { ok: false, error: "That order is already closed." };
  await c.sb.from("purchase_orders").update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  const { data: materialRows } = await c.sb.from("purchase_order_lines").select("material_id").eq("purchase_order_id", id);
  await settleOnOrderFlags(c.sb, c.me.organization_id, ((materialRows ?? []) as { material_id: string | null }[]).map((r) => r.material_id).filter(Boolean) as string[]);
  return done("Cancelled.");
}

/* -------------------------------------------------------------------------
 * One-offs the owner starts by hand
 * ---------------------------------------------------------------------- */

/**
 * Drafts reorders for everything below its reorder point now, including what
 * was already low before reorders were switched on. This is the explicit
 * one-off the backlog rule allows; the automation never does it by itself.
 */
export async function raiseReordersNow(): Promise<ActionResult> {
  const c = await caller({ ownerOnly: true });
  if ("error" in c) return { ok: false, error: c.error! };
  const settings = await loadPurchasingSettings(c.sb, c.me.organization_id);
  if (!settings.ready) return { ok: false, error: "The purchasing tables aren't set up yet (migration 0360)." };
  const made = await raiseReorders(c.sb, c.me.organization_id, settings, { all: true, createdBy: c.me.id, today: dateKeyIn(new Date()) });
  return done(made ? `${made} reorder${made === 1 ? "" : "s"} drafted.` : "Nothing new to reorder.");
}

/** Works out one job's materials now, whether or not the automation is on. */
export async function buildTakeoffNow(jobId: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  // Jobs belong to a business through the client who owns the property.
  const { data: job } = await c.sb
    .from("jobs")
    .select("id, property:properties!inner(customers!inner(organization_id))")
    .eq("id", jobId)
    .eq("property.customers.organization_id", c.me.organization_id)
    .maybeSingle();
  if (!job) return { ok: false, error: "That job isn't one of ours." };
  const settings = await loadPurchasingSettings(c.sb, c.me.organization_id);
  if (!settings.ready) return { ok: false, error: "The purchasing tables aren't set up yet (migration 0360)." };
  try {
    const result = await buildTakeoffForJob(c.sb, c.me.organization_id, jobId, settings, c.me.id);
    if (result.skipped && result.orders === 0) return done(`Nothing drafted: ${result.skipped}.`);
    return done(`${result.orders} order${result.orders === 1 ? "" : "s"} drafted.`);
  } catch {
    return { ok: false, error: "Couldn't work out the materials for that job." };
  }
}

/* -------------------------------------------------------------------------
 * Where things come from
 * ---------------------------------------------------------------------- */

export async function saveSupplierEmail(supplierId: string, email: string): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const value = email.trim();
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: "That doesn't look like an email address." };
  const { error } = await c.sb
    .from("material_suppliers")
    .update({ email: value || null, updated_at: new Date().toISOString() })
    .eq("id", supplierId)
    .eq("organization_id", c.me.organization_id);
  if (error) return { ok: false, error: "Couldn't save the email." };
  return done("Email saved.");
}

/** Which of our materials a supplier's product is, and whether it is the one to order. */
export async function linkSupplierProduct(productId: string, materialId: string | null, preferred: boolean): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  if (materialId) {
    const { data } = await c.sb.from("materials").select("id").eq("id", materialId).eq("organization_id", c.me.organization_id).maybeSingle();
    if (!data) return { ok: false, error: "That material isn't one of ours." };
  }
  const { error } = await c.sb
    .from("supplier_products")
    .update({ material_id: materialId, preferred: materialId ? preferred : false, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("organization_id", c.me.organization_id);
  if (error) return { ok: false, error: "Couldn't link that product." };
  // One preferred product per material: choosing this one un-chooses the rest.
  if (materialId && preferred) {
    await c.sb
      .from("supplier_products")
      .update({ preferred: false })
      .eq("organization_id", c.me.organization_id)
      .eq("material_id", materialId)
      .neq("id", productId);
  }
  return done("Saved.");
}

export async function saveMaterialSourcing(materialId: string, input: { preferredSupplierId: string | null; reorderQuantity: number | null }): Promise<ActionResult> {
  const c = await caller();
  if ("error" in c) return { ok: false, error: c.error! };
  const quantity = input.reorderQuantity == null || Number.isNaN(input.reorderQuantity) ? null : Number(input.reorderQuantity);
  if (quantity != null && !(quantity > 0)) return { ok: false, error: "Reorder quantity has to be more than zero, or blank." };
  if (input.preferredSupplierId) {
    const { data } = await c.sb.from("material_suppliers").select("id").eq("id", input.preferredSupplierId).eq("organization_id", c.me.organization_id).maybeSingle();
    if (!data) return { ok: false, error: "That supplier isn't one of ours." };
  }
  const { error } = await c.sb
    .from("materials")
    .update({ preferred_supplier_id: input.preferredSupplierId, reorder_quantity: quantity })
    .eq("id", materialId)
    .eq("organization_id", c.me.organization_id);
  if (error) return { ok: false, error: "Couldn't save that material." };
  return done("Saved.");
}
