import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOutbound } from "@/lib/email/outbound";
import { log } from "@/lib/log";
import { dateKeyIn } from "@/lib/time-zone";
import {
  aggregateNeeds,
  groupIntoOrders,
  materialsLate,
  neededByDate,
  planTakeoff,
  poEmail,
  reorderAmount,
  resolveSource,
  shouldAutoApprove,
  toOrderUnit,
  OPEN_PO_STATUSES,
  type EstimateMaterialLine,
  type PoStatus,
  type SourcingMaterial,
  type SourcingProduct,
  type SourcingSupplier,
  type StockLevel,
  type TakeoffLine,
} from "@/lib/purchasing/takeoff";
import { leadsForJob, orgLeads, tellLeads } from "@/lib/data/supply-people";

/**
 * Purchasing, against the database: takeoffs, purchase orders, reorders,
 * sending, and the late-materials check.
 *
 * Every function takes the client it should use. The cron passes the service
 * role (nobody is signed in); the panel's actions pass it too, after checking
 * the caller, and always scope by organisation themselves. The arithmetic is
 * in src/lib/purchasing/takeoff.ts.
 *
 * Nothing here acts on the backlog. Each automation reads its switch and the
 * moment it was first turned on, and only touches jobs, materials and orders
 * created or changed after that.
 */

// The purchasing tables are newer than the generated types.
export const untyped = (c: unknown) => c as SupabaseClient;

export interface PurchasingSettings {
  takeoffEnabled: boolean;
  takeoffStartedAt: string | null;
  reorderEnabled: boolean;
  reorderStartedAt: string | null;
  autoSendEnabled: boolean;
  autoSendStartedAt: string | null;
  autoApproveUnderCents: number;
  notifyLead: boolean;
  inHandDaysBefore: number;
  /** False until the 0360 migration has run. */
  ready: boolean;
}

export const DEFAULT_PURCHASING: PurchasingSettings = {
  takeoffEnabled: false,
  takeoffStartedAt: null,
  reorderEnabled: false,
  reorderStartedAt: null,
  autoSendEnabled: false,
  autoSendStartedAt: null,
  autoApproveUnderCents: 50000,
  notifyLead: true,
  inHandDaysBefore: 2,
  ready: true,
};

export async function loadPurchasingSettings(sb: SupabaseClient, organizationId: string): Promise<PurchasingSettings> {
  const { data, error } = await sb.from("purchasing_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) return { ...DEFAULT_PURCHASING, ready: false };
  if (!data) return DEFAULT_PURCHASING;
  return {
    takeoffEnabled: Boolean(data.takeoff_enabled),
    takeoffStartedAt: data.takeoff_started_at ?? null,
    reorderEnabled: Boolean(data.reorder_enabled),
    reorderStartedAt: data.reorder_started_at ?? null,
    autoSendEnabled: Boolean(data.auto_send_enabled),
    autoSendStartedAt: data.auto_send_started_at ?? null,
    autoApproveUnderCents: Number(data.auto_approve_under_cents ?? 50000),
    notifyLead: data.notify_lead !== false,
    inHandDaysBefore: Number(data.in_hand_days_before ?? 2),
    ready: true,
  };
}

/* -------------------------------------------------------------------------
 * Shared reads
 * ---------------------------------------------------------------------- */

interface MaterialRow {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: number | null;
  quantity_on_hand: number | null;
  reorder_threshold: number | null;
  reorder_quantity: number | null;
  preferred_supplier_id: string | null;
  on_order: boolean;
  active: boolean;
  updated_at: string;
}

interface Sourcing {
  materials: MaterialRow[];
  products: SourcingProduct[];
  suppliers: SourcingSupplier[];
}

async function loadSourcing(sb: SupabaseClient, organizationId: string): Promise<Sourcing> {
  const [{ data: materials }, { data: products }, { data: suppliers }] = await Promise.all([
    sb
      .from("materials")
      .select("id, name, unit, cost_per_unit, quantity_on_hand, reorder_threshold, reorder_quantity, preferred_supplier_id, on_order, active, updated_at")
      .eq("organization_id", organizationId),
    sb
      .from("supplier_products")
      .select("id, supplier_id, material_id, kind, name, unit, price_cents, delivered_price_cents, preferred, active")
      .eq("organization_id", organizationId),
    sb.from("material_suppliers").select("id, name, email, delivers, delivery_minimum, active").eq("organization_id", organizationId),
  ]);
  return {
    materials: (materials ?? []) as MaterialRow[],
    products: ((products ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      supplierId: p.supplier_id as string,
      materialId: (p.material_id as string | null) ?? null,
      kind: p.kind as string,
      name: p.name as string,
      unit: p.unit as "yd" | "ton",
      priceCents: (p.price_cents as number | null) ?? null,
      deliveredPriceCents: (p.delivered_price_cents as number | null) ?? null,
      preferred: Boolean(p.preferred),
      active: p.active !== false,
    })),
    suppliers: ((suppliers ?? []) as Record<string, unknown>[]).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      email: (s.email as string | null) ?? null,
      delivers: s.delivers !== false,
      deliveryMinimum: s.delivery_minimum == null ? null : Number(s.delivery_minimum),
      active: s.active !== false,
    })),
  };
}

const asSourcingMaterial = (m: MaterialRow): SourcingMaterial => ({
  id: m.id,
  name: m.name,
  unit: m.unit,
  costPerUnit: m.cost_per_unit == null ? null : Number(m.cost_per_unit),
  preferredSupplierId: m.preferred_supplier_id,
});

/** Stock set aside for open takeoffs, by material, optionally leaving one job out. */
async function reservedByMaterial(sb: SupabaseClient, organizationId: string, exceptJobId?: string): Promise<Map<string, number>> {
  const { data } = await sb.from("job_material_takeoffs").select("job_id, lines").eq("organization_id", organizationId).eq("status", "open");
  const out = new Map<string, number>();
  for (const row of (data ?? []) as { job_id: string; lines: TakeoffLine[] }[]) {
    if (row.job_id === exceptJobId) continue;
    for (const line of row.lines ?? []) {
      if (!line.materialId || !line.fromStock) continue;
      out.set(line.materialId, (out.get(line.materialId) ?? 0) + Number(line.fromStock));
    }
  }
  return out;
}

/** What is still to come in on open orders, by material, in the material's unit. */
async function onOrderByMaterial(sb: SupabaseClient, organizationId: string): Promise<Map<string, number>> {
  const { data } = await sb
    .from("purchase_order_lines")
    .select("material_id, quantity, received_quantity, purchase_orders!inner(status)")
    .eq("organization_id", organizationId)
    .in("purchase_orders.status", [...OPEN_PO_STATUSES])
    .not("material_id", "is", null);
  const out = new Map<string, number>();
  for (const row of (data ?? []) as { material_id: string; quantity: number; received_quantity: number }[]) {
    const left = Math.max(0, Number(row.quantity) - Number(row.received_quantity ?? 0));
    out.set(row.material_id, (out.get(row.material_id) ?? 0) + left);
  }
  return out;
}

/** The first day of work on a job: its earliest live visit, else the project start date. */
async function firstWorkDay(sb: SupabaseClient, jobId: string): Promise<string | null> {
  const [{ data: sessions }, { data: job }] = await Promise.all([
    sb.from("job_work_sessions").select("starts_on").eq("job_id", jobId).neq("status", "cancelled").order("starts_on", { ascending: true }).limit(1),
    sb.from("jobs").select("project_start_date").eq("id", jobId).maybeSingle(),
  ]);
  const first = ((sessions ?? []) as { starts_on: string }[])[0]?.starts_on ?? null;
  return first ?? (job as { project_start_date: string | null } | null)?.project_start_date ?? null;
}

/* -------------------------------------------------------------------------
 * Writing orders
 * ---------------------------------------------------------------------- */

interface DraftLineWithSupplier {
  materialId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unit: string;
  orderQuantity: number;
  orderUnit: string;
  unitCostCents: number | null;
  supplierId: string | null;
}

/** Each to-order line with where it comes from and what it costs, in the supplier's unit. */
function sourceLines(lines: { materialId: string | null; name: string; unit: string; quantity: number }[], sourcing: Sourcing): DraftLineWithSupplier[] {
  const materialById = new Map(sourcing.materials.map((m) => [m.id, m]));
  return lines.map((line) => {
    const material = line.materialId ? materialById.get(line.materialId) : null;
    if (!material) {
      return { ...line, productId: null, orderQuantity: line.quantity, orderUnit: line.unit, unitCostCents: null, supplierId: null };
    }
    const source = resolveSource(asSourcingMaterial(material), sourcing.products, sourcing.suppliers);
    return {
      ...line,
      productId: source.productId,
      orderQuantity: toOrderUnit(line.quantity, line.unit, source.orderUnit),
      orderUnit: source.orderUnit,
      unitCostCents: source.unitCostCents,
      supplierId: source.supplierId,
    };
  });
}

interface CreatedOrder {
  id: string;
  supplierId: string | null;
  approved: boolean;
  subtotalCents: number;
}

/** Writes draft orders, one per supplier. A dedupe key that already exists writes nothing. */
async function writeOrders(
  sb: SupabaseClient,
  input: {
    organizationId: string;
    source: "takeoff" | "reorder" | "manual";
    jobId: string | null;
    takeoffId: string | null;
    neededBy: string | null;
    firstWorkDay: string | null;
    lines: DraftLineWithSupplier[];
    sourcing: Sourcing;
    settings: PurchasingSettings;
    dedupePrefix: string;
    createdBy?: string | null;
  }
): Promise<CreatedOrder[]> {
  const orders = groupIntoOrders(input.lines, input.sourcing.suppliers);
  const created: CreatedOrder[] = [];
  for (const order of orders) {
    const approved = shouldAutoApprove(order, input.settings.autoApproveUnderCents);
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from("purchase_orders")
      .insert({
        organization_id: input.organizationId,
        supplier_id: order.supplierId,
        status: "draft",
        source: input.source,
        job_id: input.jobId,
        takeoff_id: input.takeoffId,
        fulfilment: order.fulfilment,
        needed_by: input.neededBy,
        first_work_day: input.firstWorkDay,
        subtotal_cents: order.subtotalCents,
        fully_priced: order.fullyPriced,
        approved_at: approved ? now : null,
        auto_approved: approved,
        notes: order.notes.join(" ") || null,
        dedupe_key: `${input.dedupePrefix}:${order.supplierId ?? "none"}`,
        created_by: input.createdBy ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // 23505: this run, or an earlier one, already made it.
      if (error.code !== "23505") log.error("purchasing.order_insert_failed", undefined, { message: error.message });
      continue;
    }
    const poId = (data as { id: string }).id;
    const { error: lineError } = await sb.from("purchase_order_lines").insert(
      order.lines.map((l) => ({
        organization_id: input.organizationId,
        purchase_order_id: poId,
        material_id: l.materialId,
        supplier_product_id: l.productId,
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        order_quantity: l.orderQuantity,
        order_unit: l.orderUnit,
        unit_cost_cents: l.unitCostCents,
        job_id: input.jobId,
      }))
    );
    if (lineError) log.error("purchasing.lines_insert_failed", undefined, { poId, message: lineError.message });
    // The shelf shows "on order" for anything with an open order, as the
    // materials page already does.
    const materialIds = order.lines.map((l) => l.materialId).filter((id): id is string => Boolean(id));
    if (materialIds.length) await sb.from("materials").update({ on_order: true }).in("id", materialIds);
    created.push({ id: poId, supplierId: order.supplierId, approved, subtotalCents: order.subtotalCents });
  }
  return created;
}

/* -------------------------------------------------------------------------
 * Takeoffs
 * ---------------------------------------------------------------------- */

export interface TakeoffResult {
  jobId: string;
  orders: number;
  skipped?: string;
}

/**
 * Totals what an accepted job needs, takes off the shelf, and drafts orders.
 *
 * Once per job: the takeoff row is unique on the job, written first, and a
 * second run that loses the race writes nothing. An accepted job with no
 * estimate gets an empty takeoff so it is not looked at again every run.
 */
export async function buildTakeoffForJob(
  sb: SupabaseClient,
  organizationId: string,
  jobId: string,
  settings: PurchasingSettings,
  createdBy?: string | null
): Promise<TakeoffResult> {
  const { data: proposal } = await sb
    .from("job_proposals")
    .select("id, estimate")
    .eq("job_id", jobId)
    .eq("status", "accepted")
    .order("responded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // Not accepted yet (a visit booked ahead of the yes): nothing is written,
  // so the job is looked at again once it is.
  if (!proposal) return { jobId, orders: 0, skipped: "no accepted proposal" };
  const estimate = (proposal as { estimate: { materials?: EstimateMaterialLine[] } | null }).estimate ?? null;
  const estimateLines: EstimateMaterialLine[] = Array.isArray(estimate?.materials) ? estimate!.materials! : [];

  const [sourcing, reserved, first] = await Promise.all([loadSourcing(sb, organizationId), reservedByMaterial(sb, organizationId, jobId), firstWorkDay(sb, jobId)]);
  const needs = aggregateNeeds(
    estimateLines,
    sourcing.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))
  );
  const stock = new Map<string, StockLevel>(
    sourcing.materials.map((m) => [m.id, { onHand: Number(m.quantity_on_hand ?? 0), reserved: reserved.get(m.id) ?? 0 }])
  );
  const takeoff = planTakeoff(needs, stock);
  const neededBy = neededByDate(first, settings.inHandDaysBefore);
  // Work already under way: whatever it needed has been found. Recorded, so
  // it isn't looked at again, but nothing is ordered and no stock is held.
  const started = Boolean(first && first < dateKeyIn(new Date()));

  const { data: row, error } = await sb
    .from("job_material_takeoffs")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      proposal_id: (proposal as { id: string }).id,
      first_work_day: first,
      needed_by: neededBy,
      lines: takeoff,
      status: started ? "closed" : "open",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { jobId, orders: 0, skipped: "already taken off" };
    throw error;
  }
  const takeoffId = (row as { id: string }).id;
  if (started) return { jobId, orders: 0, skipped: "work already started" };

  const toOrder = takeoff
    .filter((l) => l.toOrder > 0)
    .map((l) => ({ materialId: l.materialId, name: l.name, unit: l.unit, quantity: l.toOrder }));
  if (toOrder.length === 0) return { jobId, orders: 0, skipped: estimateLines.length ? "all from stock" : "no materials on the estimate" };

  const created = await writeOrders(sb, {
    organizationId,
    source: "takeoff",
    jobId,
    takeoffId,
    neededBy,
    firstWorkDay: first,
    lines: sourceLines(toOrder, sourcing),
    sourcing,
    settings,
    dedupePrefix: `takeoff:${jobId}`,
    createdBy,
  });

  if (settings.notifyLead && created.length) {
    const { data: job } = await sb.from("jobs").select("name").eq("id", jobId).maybeSingle();
    const name = (job as { name: string } | null)?.name ?? "a job";
    const waiting = created.filter((c) => !c.approved).length;
    const body =
      `Materials for ${name}: ${created.length} purchase order${created.length === 1 ? "" : "s"} drafted` +
      (neededBy ? `, needed by ${neededBy}` : "") +
      (waiting ? `. ${waiting} need${waiting === 1 ? "s" : ""} approving.` : ".");
    await tellLeads(await leadsForJob(sb, organizationId, jobId), body, `po-drafted:${jobId}`);
  }
  return { jobId, orders: created.length };
}

/** Jobs accepted or scheduled since the switch was turned on, with no takeoff yet. */
async function takeoffCandidates(sb: SupabaseClient, organizationId: string, since: string): Promise<string[]> {
  const [{ data: accepted }, { data: scheduled }, { data: done }] = await Promise.all([
    sb.from("job_proposals").select("job_id").eq("organization_id", organizationId).eq("status", "accepted").gte("responded_at", since),
    sb.from("job_work_sessions").select("job_id").eq("organization_id", organizationId).neq("status", "cancelled").gte("created_at", since),
    sb.from("job_material_takeoffs").select("job_id").eq("organization_id", organizationId),
  ]);
  const have = new Set(((done ?? []) as { job_id: string }[]).map((r) => r.job_id));
  const ids = new Set([...((accepted ?? []) as { job_id: string }[]), ...((scheduled ?? []) as { job_id: string }[])].map((r) => r.job_id));
  const fresh = [...ids].filter((id) => !have.has(id));
  if (fresh.length === 0) return [];
  // A cancelled or declined job needs nothing bought for it.
  const { data: jobs } = await sb.from("jobs").select("id, status, cancelled_at, declined_at").in("id", fresh);
  return ((jobs ?? []) as { id: string; status: string; cancelled_at: string | null; declined_at: string | null }[])
    .filter((j) => j.status !== "cancelled" && !j.cancelled_at && !j.declined_at)
    .map((j) => j.id);
}

/**
 * Keeps open takeoffs' dates in step with the schedule, and closes the ones
 * whose work has started (the stock they set aside has been used) or whose
 * job was called off (the stock goes back on the shelf for the next one).
 */
async function refreshTakeoffs(sb: SupabaseClient, organizationId: string, settings: PurchasingSettings, today: string): Promise<void> {
  const { data } = await sb.from("job_material_takeoffs").select("id, job_id, first_work_day").eq("organization_id", organizationId).eq("status", "open");
  for (const t of (data ?? []) as { id: string; job_id: string; first_work_day: string | null }[]) {
    const { data: job } = await sb.from("jobs").select("status, cancelled_at, declined_at").eq("id", t.job_id).maybeSingle();
    const j = job as { status: string; cancelled_at: string | null; declined_at: string | null } | null;
    if (!j || j.status === "cancelled" || j.cancelled_at || j.declined_at) {
      await sb.from("job_material_takeoffs").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", t.id);
      continue;
    }
    const first = await firstWorkDay(sb, t.job_id);
    if (first && first < today) {
      await sb.from("job_material_takeoffs").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", t.id);
      continue;
    }
    if (first !== t.first_work_day) {
      const neededBy = neededByDate(first, settings.inHandDaysBefore);
      await sb.from("job_material_takeoffs").update({ first_work_day: first, needed_by: neededBy, updated_at: new Date().toISOString() }).eq("id", t.id);
      await sb
        .from("purchase_orders")
        .update({ first_work_day: first, needed_by: neededBy, updated_at: new Date().toISOString() })
        .eq("takeoff_id", t.id)
        .in("status", [...OPEN_PO_STATUSES]);
    }
  }
}

/* -------------------------------------------------------------------------
 * Late materials become an exception for the lead
 * ---------------------------------------------------------------------- */

/** Claims the key, then writes the exception. A second run finds the claim and stops. */
export async function raiseClaimedException(
  sb: SupabaseClient,
  input: { organizationId: string; dedupeKey: string; jobId: string; kind: string; summary: string; detail: string; workSessionId?: string | null }
): Promise<string | null> {
  const { error: claimError } = await sb.from("supply_exception_claims").insert({ organization_id: input.organizationId, dedupe_key: input.dedupeKey });
  if (claimError) return null;
  const { data, error } = await sb
    .from("job_exceptions")
    .insert({
      organization_id: input.organizationId,
      job_id: input.jobId,
      work_session_id: input.workSessionId ?? null,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      blocks_work: false,
      reported_by: null,
    })
    .select("id")
    .single();
  if (error) {
    log.error("supply.exception_failed", undefined, { key: input.dedupeKey, message: error.message });
    // Give the claim back so the next run tries again.
    await sb.from("supply_exception_claims").delete().eq("organization_id", input.organizationId).eq("dedupe_key", input.dedupeKey);
    return null;
  }
  const id = (data as { id: string }).id;
  await sb.from("supply_exception_claims").update({ job_exception_id: id }).eq("organization_id", input.organizationId).eq("dedupe_key", input.dedupeKey);
  return id;
}

async function checkLateMaterials(sb: SupabaseClient, organizationId: string, settings: PurchasingSettings, today: string): Promise<number> {
  const { data } = await sb
    .from("job_material_takeoffs")
    .select("id, job_id, first_work_day, lines, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .not("first_work_day", "is", null);
  let raised = 0;
  for (const t of (data ?? []) as { id: string; job_id: string; first_work_day: string; lines: TakeoffLine[]; created_at: string }[]) {
    const { data: orders } = await sb.from("purchase_orders").select("status, po_number").eq("takeoff_id", t.id);
    const statuses = ((orders ?? []) as { status: PoStatus }[]).map((o) => o.status);
    // A line with no quantity on the estimate is "not in hand" too: nobody knows how much to have.
    const unknown = (t.lines ?? []).filter((l) => l.needed == null);
    const late = materialsLate({ today, firstWorkDay: t.first_work_day, daysBefore: settings.inHandDaysBefore, orderStatuses: statuses }) ||
      (unknown.length > 0 && materialsLate({ today, firstWorkDay: t.first_work_day, daysBefore: settings.inHandDaysBefore, orderStatuses: ["draft"] }));
    if (!late) continue;
    const open = ((orders ?? []) as { status: PoStatus; po_number: number }[]).filter((o) => !["delivered", "picked_up", "cancelled"].includes(o.status));
    const detail = [
      open.length ? `Not in hand: ${open.map((o) => `PO ${o.po_number} (${o.status})`).join(", ")}.` : null,
      unknown.length ? `No quantity known for ${unknown.map((l) => l.name).join(", ")}.` : null,
      `Work starts ${t.first_work_day}.`,
    ]
      .filter(Boolean)
      .join(" ");
    const id = await raiseClaimedException(sb, {
      organizationId,
      dedupeKey: `materials-late:${t.job_id}:${t.first_work_day}`,
      jobId: t.job_id,
      kind: "material_discrepancy",
      summary: "Materials aren't in hand two days before the work",
      detail,
    });
    if (!id) continue;
    raised++;
    if (settings.notifyLead) {
      const { data: job } = await sb.from("jobs").select("name").eq("id", t.job_id).maybeSingle();
      await tellLeads(
        await leadsForJob(sb, organizationId, t.job_id),
        `Materials for ${(job as { name: string } | null)?.name ?? "a job"} aren't in hand and work starts ${t.first_work_day}. ${detail}`,
        `materials-late:${t.job_id}:${t.first_work_day}`
      );
    }
  }
  return raised;
}

/* -------------------------------------------------------------------------
 * Reorders
 * ---------------------------------------------------------------------- */

/**
 * Drafts an order for each material below its reorder point.
 *
 * Only materials changed since the switch was turned on, unless `all` is set
 * by the owner pressing "raise reorders for everything low now": that button
 * is the one-off campaign the rules allow. Anything with an open order is
 * left alone, and the key is per material per day, so running twice drafts
 * once.
 */
export async function raiseReorders(
  sb: SupabaseClient,
  organizationId: string,
  settings: PurchasingSettings,
  options: { all?: boolean; createdBy?: string | null; today: string }
): Promise<number> {
  const [sourcing, onOrder] = await Promise.all([loadSourcing(sb, organizationId), onOrderByMaterial(sb, organizationId)]);
  const since = settings.reorderStartedAt;
  const low = sourcing.materials.filter((m) => {
    if (!m.active) return false;
    if (!options.all && (!since || m.updated_at < since)) return false;
    return (onOrder.get(m.id) ?? 0) === 0 &&
      reorderAmount({ onHand: m.quantity_on_hand == null ? null : Number(m.quantity_on_hand), threshold: m.reorder_threshold == null ? null : Number(m.reorder_threshold), onOrder: 0, reorderQuantity: m.reorder_quantity == null ? null : Number(m.reorder_quantity) }) != null;
  });
  let made = 0;
  for (const m of low) {
    const quantity = reorderAmount({
      onHand: Number(m.quantity_on_hand),
      threshold: Number(m.reorder_threshold),
      onOrder: 0,
      reorderQuantity: m.reorder_quantity == null ? null : Number(m.reorder_quantity),
    })!;
    const created = await writeOrders(sb, {
      organizationId,
      source: "reorder",
      jobId: null,
      takeoffId: null,
      neededBy: null,
      firstWorkDay: null,
      lines: sourceLines([{ materialId: m.id, name: m.name, unit: m.unit, quantity }], sourcing),
      sourcing,
      settings,
      dedupePrefix: `reorder:${m.id}:${options.today}`,
      createdBy: options.createdBy,
    });
    made += created.length;
  }
  if (made > 0 && settings.notifyLead && !options.createdBy) {
    await tellLeads(
      await orgLeads(sb, organizationId),
      `${made} reorder${made === 1 ? "" : "s"} drafted for materials below their reorder point. See Operations › Materials & equipment.`,
      `reorders:${organizationId}:${options.today}`
    );
  }
  return made;
}

/* -------------------------------------------------------------------------
 * Sending to the supplier
 * ---------------------------------------------------------------------- */

export type SendPoResult = { ok: true; via: string } | { ok: false; message: string };

/**
 * Emails one approved order to its supplier.
 *
 * Claimed before it is sent, so the cron and a person pressing Send at the
 * same moment send it once. Supplier mail is business mail, not client mail,
 * so it goes through the app's own outbound sender (Resend from the verified
 * domain, Gmail as the fallback), never the client-messaging gate.
 */
export async function sendPurchaseOrder(sb: SupabaseClient, organizationId: string, poId: string): Promise<SendPoResult> {
  const { data: po } = await sb
    .from("purchase_orders")
    .select("id, po_number, supplier_id, status, approved_at, fulfilment, needed_by, notes, job_id, sent_at")
    .eq("id", poId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const order = po as {
    id: string;
    po_number: number;
    supplier_id: string | null;
    status: PoStatus;
    approved_at: string | null;
    fulfilment: "delivery" | "pickup";
    needed_by: string | null;
    notes: string | null;
    job_id: string | null;
    sent_at: string | null;
  } | null;
  if (!order) return { ok: false, message: "That order isn't there any more." };
  if (order.sent_at || order.status !== "draft") return { ok: false, message: "That order has already gone." };
  if (!order.approved_at) return { ok: false, message: "Approve the order before sending it." };
  if (!order.supplier_id) return { ok: false, message: "Pick a supplier first." };

  const [{ data: supplier }, { data: lines }, { data: org }] = await Promise.all([
    sb.from("material_suppliers").select("name, email").eq("id", order.supplier_id).maybeSingle(),
    sb.from("purchase_order_lines").select("name, order_quantity, order_unit, quantity, unit").eq("purchase_order_id", poId),
    sb.from("organizations").select("name, business_phone, business_address").eq("id", organizationId).maybeSingle(),
  ]);
  const s = supplier as { name: string; email: string | null } | null;
  if (!s?.email) return { ok: false, message: `${s?.name ?? "The supplier"} has no email address. Add one on the Suppliers page, or phone the order in.` };

  let deliverTo = (org as { business_address: string | null } | null)?.business_address ?? null;
  if (order.job_id && order.fulfilment === "delivery") {
    const { data: job } = await sb.from("jobs").select("properties(address)").eq("id", order.job_id).maybeSingle();
    deliverTo = (job as { properties: { address: string | null } | null } | null)?.properties?.address ?? deliverTo;
  }

  // The claim: only one caller gets the row back.
  const { data: claimed } = await sb
    .from("purchase_orders")
    .update({ send_claimed_at: new Date().toISOString() })
    .eq("id", poId)
    .is("send_claimed_at", null)
    .is("sent_at", null)
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, message: "That order is already being sent." };

  const businessName = (org as { name: string } | null)?.name ?? "Our business";
  const email = poEmail({
    businessName,
    businessPhone: (org as { business_phone: string | null } | null)?.business_phone ?? null,
    poNumber: order.po_number,
    supplierName: s.name,
    fulfilment: order.fulfilment,
    neededBy: order.needed_by,
    deliverTo,
    lines: ((lines ?? []) as { name: string; order_quantity: number | null; order_unit: string | null; quantity: number; unit: string }[]).map((l) => ({
      name: l.name,
      orderQuantity: Number(l.order_quantity ?? l.quantity),
      orderUnit: l.order_unit ?? l.unit,
    })),
    notes: null,
  });
  const sent = await sendOutbound({ organizationId, to: s.email, toName: s.name, subject: email.subject, text: email.text, fromName: businessName });
  if (!sent.ok) {
    // Release the claim so it can be tried again once the sender is fixed.
    await sb.from("purchase_orders").update({ send_claimed_at: null, send_error: sent.message, updated_at: new Date().toISOString() }).eq("id", poId);
    return { ok: false, message: sent.message };
  }
  await sb
    .from("purchase_orders")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: sent.via, send_error: null, updated_at: new Date().toISOString() })
    .eq("id", poId);
  return { ok: true, via: sent.via };
}

async function autoSend(sb: SupabaseClient, organizationId: string, settings: PurchasingSettings): Promise<number> {
  if (!settings.autoSendEnabled || !settings.autoSendStartedAt) return 0;
  const { data } = await sb
    .from("purchase_orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .not("approved_at", "is", null)
    .not("supplier_id", "is", null)
    .is("send_claimed_at", null)
    // A failed send waits for a person, so a broken sender isn't retried every run.
    .is("send_error", null)
    .gte("created_at", settings.autoSendStartedAt);
  let sent = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    const result = await sendPurchaseOrder(sb, organizationId, row.id);
    if (result.ok) sent++;
  }
  return sent;
}

/* -------------------------------------------------------------------------
 * Receiving
 * ---------------------------------------------------------------------- */

/**
 * Adds what arrived to the shelf. The received amount on each line goes up
 * by what came, the material's on-hand count goes up by the same, and an
 * inventory movement records it, as every other stock change does.
 */
export async function receiveLines(
  sb: SupabaseClient,
  organizationId: string,
  poId: string,
  received: { lineId: string; quantity: number }[],
  profileId: string | null
): Promise<{ lines: { quantity: number; received: number }[] }> {
  const { data: lines } = await sb
    .from("purchase_order_lines")
    .select("id, material_id, quantity, received_quantity, job_id")
    .eq("purchase_order_id", poId)
    .eq("organization_id", organizationId);
  const rows = (lines ?? []) as { id: string; material_id: string | null; quantity: number; received_quantity: number; job_id: string | null }[];
  for (const r of received) {
    const line = rows.find((l) => l.id === r.lineId);
    if (!line || !(r.quantity > 0)) continue;
    const next = Number(line.received_quantity ?? 0) + r.quantity;
    await sb.from("purchase_order_lines").update({ received_quantity: next }).eq("id", line.id);
    line.received_quantity = next;
    if (line.material_id) {
      const { data: m } = await sb.from("materials").select("quantity_on_hand").eq("id", line.material_id).maybeSingle();
      const onHand = Number((m as { quantity_on_hand: number | null } | null)?.quantity_on_hand ?? 0) + r.quantity;
      await sb.from("materials").update({ quantity_on_hand: Math.round(onHand * 100) / 100 }).eq("id", line.material_id);
      await sb.from("inventory_movements").insert({
        organization_id: organizationId,
        material_id: line.material_id,
        direction: "in",
        quantity: r.quantity,
        profile_id: profileId,
        job_id: line.job_id,
        note: `Received on purchase order`,
      });
    }
  }
  return { lines: rows.map((l) => ({ quantity: Number(l.quantity), received: Number(l.received_quantity ?? 0) })) };
}

/** Clears "on order" on materials that no longer have an open order. */
export async function settleOnOrderFlags(sb: SupabaseClient, organizationId: string, materialIds: string[]): Promise<void> {
  if (materialIds.length === 0) return;
  const open = await onOrderByMaterial(sb, organizationId);
  const done = materialIds.filter((id) => !(open.get(id) ?? 0));
  if (done.length) await sb.from("materials").update({ on_order: false }).in("id", done);
}

/* -------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------- */

export interface PurchasingRun {
  organizationId: string;
  takeoffs: TakeoffResult[];
  reorders: number;
  sent: number;
  lateExceptions: number;
  skipped?: string;
}

export async function runPurchasing(sb: SupabaseClient, organizationId: string, now = new Date()): Promise<PurchasingRun> {
  const settings = await loadPurchasingSettings(sb, organizationId);
  const run: PurchasingRun = { organizationId, takeoffs: [], reorders: 0, sent: 0, lateExceptions: 0 };
  if (!settings.ready) return { ...run, skipped: "purchasing tables not created yet" };
  const today = dateKeyIn(now);

  if (settings.takeoffEnabled && settings.takeoffStartedAt) {
    for (const jobId of await takeoffCandidates(sb, organizationId, settings.takeoffStartedAt)) {
      try {
        run.takeoffs.push(await buildTakeoffForJob(sb, organizationId, jobId, settings));
      } catch (err) {
        log.error("purchasing.takeoff_failed", undefined, { jobId, message: err instanceof Error ? err.message : String(err) });
      }
    }
    await refreshTakeoffs(sb, organizationId, settings, today);
    run.lateExceptions = await checkLateMaterials(sb, organizationId, settings, today);
  }
  if (settings.reorderEnabled && settings.reorderStartedAt) {
    run.reorders = await raiseReorders(sb, organizationId, settings, { today });
  }
  run.sent = await autoSend(sb, organizationId, settings);
  return run;
}

/* -------------------------------------------------------------------------
 * For the panel
 * ---------------------------------------------------------------------- */

/**
 * Three numbers for a page tile, in place of the old "materials below
 * reorder point" count: open orders, low materials with nothing ordered,
 * and jobs whose materials are late. Null when the tables aren't there yet.
 */
export async function loadPurchasingSummary(
  sb: SupabaseClient,
  organizationId: string,
  now = new Date()
): Promise<{ openOrders: number; awaitingApproval: number; lowWithoutOrder: number; lateJobs: number } | null> {
  const data = await loadPurchasingPanel(sb, organizationId, now);
  if (!data.settings.ready) return null;
  const open = data.orders.filter((o) => (OPEN_PO_STATUSES as readonly string[]).includes(o.status));
  return {
    openOrders: open.length,
    awaitingApproval: open.filter((o) => o.status === "draft" && !o.approvedAt).length,
    lowWithoutOrder: data.reorders.filter((r) => r.onOrder === 0).length,
    lateJobs: data.upcoming.filter((u) => u.late).length,
  };
}

export interface PoLineView {
  id: string;
  materialId: string | null;
  name: string;
  quantity: number;
  unit: string;
  orderQuantity: number | null;
  orderUnit: string | null;
  unitCostCents: number | null;
  received: number;
}

export interface PoView {
  id: string;
  poNumber: number;
  status: PoStatus;
  source: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierEmail: string | null;
  jobId: string | null;
  jobName: string | null;
  fulfilment: string;
  neededBy: string | null;
  firstWorkDay: string | null;
  subtotalCents: number;
  fullyPriced: boolean;
  approvedAt: string | null;
  autoApproved: boolean;
  sentAt: string | null;
  sendError: string | null;
  notes: string | null;
  createdAt: string;
  lines: PoLineView[];
}

export interface UpcomingNeed {
  jobId: string;
  jobName: string;
  firstWorkDay: string | null;
  neededBy: string | null;
  lines: TakeoffLine[];
  orders: { poNumber: number; status: PoStatus }[];
  late: boolean;
}

export interface ReorderRow {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  threshold: number;
  onOrder: number;
  suggested: number | null;
  hasDraft: boolean;
}

export interface PurchasingPanelData {
  settings: PurchasingSettings;
  orders: PoView[];
  upcoming: UpcomingNeed[];
  reorders: ReorderRow[];
  suppliers: { id: string; name: string; email: string | null }[];
  openExceptions: { id: string; jobId: string; jobName: string; summary: string; detail: string | null; reportedAt: string }[];
  /** Jobs that started in the last 30 days with a takeoff, and how many had everything in hand on time. */
  onTime: { started: number; inHand: number };
  /** For the "where things come from" editor. */
  sourcing: {
    materials: { id: string; name: string; unit: string; preferredSupplierId: string | null; reorderQuantity: number | null; source: string }[];
    products: { id: string; supplierId: string; supplierName: string; name: string; kind: string; unit: string; materialId: string | null; preferred: boolean }[];
  };
}

export async function loadPurchasingPanel(sb: SupabaseClient, organizationId: string, now = new Date()): Promise<PurchasingPanelData> {
  const settings = await loadPurchasingSettings(sb, organizationId);
  const today = dateKeyIn(now);
  const empty: PurchasingPanelData = {
    settings,
    orders: [],
    upcoming: [],
    reorders: [],
    suppliers: [],
    openExceptions: [],
    onTime: { started: 0, inHand: 0 },
    sourcing: { materials: [], products: [] },
  };
  if (!settings.ready) return empty;

  const since = new Date(now.getTime() - 60 * 86400000).toISOString();
  const [{ data: pos }, { data: takeoffs }, sourcing, onOrder, { data: exceptions }] = await Promise.all([
    sb
      .from("purchase_orders")
      .select("*, purchase_order_lines(*)")
      .eq("organization_id", organizationId)
      .or(`status.in.(draft,sent,confirmed,partial),created_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(200),
    sb.from("job_material_takeoffs").select("job_id, first_work_day, needed_by, lines, status, id").eq("organization_id", organizationId).order("first_work_day", { ascending: true }),
    loadSourcing(sb, organizationId),
    onOrderByMaterial(sb, organizationId),
    sb
      .from("job_exceptions")
      .select("id, job_id, summary, detail, reported_at")
      .eq("organization_id", organizationId)
      .eq("kind", "material_discrepancy")
      .in("state", ["reported", "acknowledged"])
      .is("reported_by", null)
      .order("reported_at", { ascending: false }),
  ]);

  const poRows = (pos ?? []) as Record<string, unknown>[];
  const takeoffRows = (takeoffs ?? []) as { id: string; job_id: string; first_work_day: string | null; needed_by: string | null; lines: TakeoffLine[]; status: string }[];
  const exceptionRows = (exceptions ?? []) as { id: string; job_id: string; summary: string; detail: string | null; reported_at: string }[];
  const jobIds = [...new Set([...poRows.map((p) => p.job_id as string | null), ...takeoffRows.map((t) => t.job_id), ...exceptionRows.map((e) => e.job_id)].filter(Boolean) as string[])];
  const { data: jobs } = jobIds.length ? await sb.from("jobs").select("id, name").in("id", jobIds) : { data: [] };
  const jobName = new Map(((jobs ?? []) as { id: string; name: string }[]).map((j) => [j.id, j.name]));
  const supplierById = new Map(sourcing.suppliers.map((s) => [s.id, s]));

  const orders: PoView[] = poRows.map((p) => ({
    id: p.id as string,
    poNumber: Number(p.po_number),
    status: p.status as PoStatus,
    source: p.source as string,
    supplierId: (p.supplier_id as string | null) ?? null,
    supplierName: p.supplier_id ? (supplierById.get(p.supplier_id as string)?.name ?? null) : null,
    supplierEmail: p.supplier_id ? (supplierById.get(p.supplier_id as string)?.email ?? null) : null,
    jobId: (p.job_id as string | null) ?? null,
    jobName: p.job_id ? (jobName.get(p.job_id as string) ?? null) : null,
    fulfilment: p.fulfilment as string,
    neededBy: (p.needed_by as string | null) ?? null,
    firstWorkDay: (p.first_work_day as string | null) ?? null,
    subtotalCents: Number(p.subtotal_cents ?? 0),
    fullyPriced: Boolean(p.fully_priced),
    approvedAt: (p.approved_at as string | null) ?? null,
    autoApproved: Boolean(p.auto_approved),
    sentAt: (p.sent_at as string | null) ?? null,
    sendError: (p.send_error as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    createdAt: p.created_at as string,
    lines: ((p.purchase_order_lines ?? []) as Record<string, unknown>[]).map((l) => ({
      id: l.id as string,
      materialId: (l.material_id as string | null) ?? null,
      name: l.name as string,
      quantity: Number(l.quantity),
      unit: l.unit as string,
      orderQuantity: l.order_quantity == null ? null : Number(l.order_quantity),
      orderUnit: (l.order_unit as string | null) ?? null,
      unitCostCents: l.unit_cost_cents == null ? null : Number(l.unit_cost_cents),
      received: Number(l.received_quantity ?? 0),
    })),
  }));

  const ordersByTakeoff = new Map<string, { poNumber: number; status: PoStatus }[]>();
  for (const p of poRows) {
    const t = p.takeoff_id as string | null;
    if (!t) continue;
    ordersByTakeoff.set(t, [...(ordersByTakeoff.get(t) ?? []), { poNumber: Number(p.po_number), status: p.status as PoStatus }]);
  }

  const upcoming: UpcomingNeed[] = takeoffRows
    .filter((t) => t.status === "open")
    .map((t) => {
      const orderList = ordersByTakeoff.get(t.id) ?? [];
      return {
        jobId: t.job_id,
        jobName: jobName.get(t.job_id) ?? "A job",
        firstWorkDay: t.first_work_day,
        neededBy: t.needed_by,
        lines: t.lines ?? [],
        orders: orderList,
        late: materialsLate({ today, firstWorkDay: t.first_work_day, daysBefore: settings.inHandDaysBefore, orderStatuses: orderList.map((o) => o.status) }),
      };
    });

  // On time: of takeoffs whose work started in the last 30 days, how many
  // had every order in hand. A planning number, read off the order states.
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const started = takeoffRows.filter((t) => t.first_work_day && t.first_work_day >= monthAgo && t.first_work_day <= today);
  const inHand = started.filter((t) => (ordersByTakeoff.get(t.id) ?? []).every((o) => ["delivered", "picked_up", "cancelled"].includes(o.status))).length;

  const draftMaterialIds = new Set(
    orders.filter((o) => o.status === "draft" && o.source === "reorder").flatMap((o) => o.lines.map((l) => l.materialId).filter(Boolean))
  );
  const reorders: ReorderRow[] = sourcing.materials
    .filter((m) => m.active && m.quantity_on_hand != null && m.reorder_threshold != null && Number(m.quantity_on_hand) < Number(m.reorder_threshold))
    .map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      onHand: Number(m.quantity_on_hand),
      threshold: Number(m.reorder_threshold),
      onOrder: onOrder.get(m.id) ?? 0,
      suggested: reorderAmount({ onHand: Number(m.quantity_on_hand), threshold: Number(m.reorder_threshold), onOrder: onOrder.get(m.id) ?? 0, reorderQuantity: m.reorder_quantity == null ? null : Number(m.reorder_quantity) }),
      hasDraft: draftMaterialIds.has(m.id),
    }))
    .sort((a, b) => a.onHand / a.threshold - b.onHand / b.threshold);

  return {
    settings,
    orders,
    upcoming,
    reorders,
    suppliers: sourcing.suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, email: s.email })),
    openExceptions: exceptionRows.map((e) => ({ id: e.id, jobId: e.job_id, jobName: jobName.get(e.job_id) ?? "A job", summary: e.summary, detail: e.detail, reportedAt: e.reported_at })),
    onTime: { started: started.length, inHand },
    sourcing: {
      materials: sourcing.materials
        .filter((m) => m.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => {
          const source = resolveSource(asSourcingMaterial(m), sourcing.products, sourcing.suppliers);
          return {
            id: m.id,
            name: m.name,
            unit: m.unit,
            preferredSupplierId: m.preferred_supplier_id,
            reorderQuantity: m.reorder_quantity == null ? null : Number(m.reorder_quantity),
            source: source.supplierId ? `${supplierById.get(source.supplierId)?.name ?? "?"} (${SOURCE_HOW[source.how]})` : "No supplier",
          };
        }),
      products: sourcing.products
        .filter((p) => p.active && supplierById.get(p.supplierId)?.active)
        .map((p) => ({
          id: p.id,
          supplierId: p.supplierId,
          supplierName: supplierById.get(p.supplierId)?.name ?? "",
          name: p.name,
          kind: p.kind,
          unit: p.unit,
          materialId: p.materialId,
          preferred: p.preferred,
        }))
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.name.localeCompare(b.name)),
    },
  };
}

const SOURCE_HOW: Record<string, string> = {
  "linked-preferred": "preferred product",
  linked: "linked product",
  "material-preferred": "set on the material",
  "kind-match": "guessed from the name",
  none: "none",
};
