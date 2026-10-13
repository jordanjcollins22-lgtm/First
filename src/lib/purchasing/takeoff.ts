/**
 * From an accepted estimate to draft purchase orders, as arithmetic.
 *
 * The estimate already says what each area uses ("3.2 cubic yards · $134.40").
 * This file turns those lines into one total per material, takes off what is
 * on the shelf and not already promised to another job, works out who to buy
 * the rest from, and groups it into one order per supplier with a date it has
 * to be in hand by. Pure: the database reads and writes live in
 * src/lib/data/purchasing.ts, so every rule here is tested without one.
 */

import { TONS_PER_YARD_OF_STONE } from "@/lib/material-suppliers";

/* -------------------------------------------------------------------------
 * Reading the estimate
 * ---------------------------------------------------------------------- */

/** One material line as the estimate stores it. */
export interface EstimateMaterialLine {
  name: string;
  quantityLabel: string;
  costCents: number | null;
}

/**
 * The number and unit at the front of a quantity label.
 *
 * Labels are written for people ("3.2 cubic yards (≈29 wheelbarrow loads) ·
 * $134.40", "1,200 lb · $90.00"). A manually added material says "As needed",
 * which has no quantity, and returns null: guessing one would put a made-up
 * number on an order.
 */
export function parseQuantityLabel(label: string): { quantity: number; unit: string } | null {
  const match = label.trim().match(/^([\d,]*\.?\d+)\s+([^(·$]+?)\s*(?:\(|·|$)/);
  if (!match) return null;
  const quantity = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit: match[2].trim() };
}

export interface CatalogMaterial {
  id: string;
  name: string;
  unit: string;
}

export interface MaterialNeed {
  /** Null when the estimate names something the catalogue doesn't have. */
  materialId: string | null;
  name: string;
  unit: string;
  /** Null when no line gave a quantity ("As needed"): somebody has to say. */
  needed: number | null;
}

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Totals per material across every area of the estimate, matched to the catalogue by name. */
export function aggregateNeeds(lines: readonly EstimateMaterialLine[], catalog: readonly CatalogMaterial[]): MaterialNeed[] {
  const byName = new Map(catalog.map((m) => [key(m.name), m]));
  const out = new Map<string, MaterialNeed>();
  for (const line of lines) {
    const k = key(line.name);
    if (!k) continue;
    const material = byName.get(k) ?? null;
    const parsed = parseQuantityLabel(line.quantityLabel);
    const existing = out.get(k);
    const unit = material?.unit ?? parsed?.unit ?? "each";
    if (!existing) {
      out.set(k, { materialId: material?.id ?? null, name: material?.name ?? line.name.trim(), unit, needed: parsed ? parsed.quantity : null });
    } else if (parsed) {
      existing.needed = (existing.needed ?? 0) + parsed.quantity;
    }
  }
  return [...out.values()].map((n) => ({ ...n, needed: n.needed == null ? null : round2(n.needed) }));
}

/* -------------------------------------------------------------------------
 * Taking off what is on the shelf
 * ---------------------------------------------------------------------- */

export interface StockLevel {
  onHand: number;
  /** Set aside for other jobs' open takeoffs. */
  reserved: number;
}

export interface TakeoffLine extends MaterialNeed {
  fromStock: number;
  toOrder: number;
  /** Something a person needs to know about this line, in words. */
  note: string | null;
}

/**
 * What comes off the shelf and what has to be bought.
 *
 * Stock already promised to another job's open takeoff is not available. That
 * is the whole point of keeping takeoffs: "eight yards in the bay" means
 * nothing if five of them are going to Tuesday's job.
 */
export function planTakeoff(needs: readonly MaterialNeed[], stock: ReadonlyMap<string, StockLevel>): TakeoffLine[] {
  return needs.map((need) => {
    if (need.needed == null) {
      return { ...need, fromStock: 0, toOrder: 0, note: "No quantity on the estimate. Check how much is needed." };
    }
    if (!need.materialId) {
      return { ...need, fromStock: 0, toOrder: need.needed, note: "Not in the materials list, so stock can't be checked." };
    }
    const level = stock.get(need.materialId);
    const available = Math.max(0, (level?.onHand ?? 0) - (level?.reserved ?? 0));
    const fromStock = round2(Math.min(available, need.needed));
    return { ...need, fromStock, toOrder: round2(need.needed - fromStock), note: null };
  });
}

/* -------------------------------------------------------------------------
 * Who to buy from
 * ---------------------------------------------------------------------- */

export interface SourcingProduct {
  id: string;
  supplierId: string;
  materialId: string | null;
  kind: string;
  name: string;
  unit: "yd" | "ton";
  priceCents: number | null;
  deliveredPriceCents: number | null;
  preferred: boolean;
  active: boolean;
}

export interface SourcingSupplier {
  id: string;
  name: string;
  email: string | null;
  delivers: boolean;
  /** In yards or tons. */
  deliveryMinimum: number | null;
  active: boolean;
}

export interface SourcingMaterial {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number | null;
  preferredSupplierId: string | null;
}

export interface Source {
  supplierId: string | null;
  productId: string | null;
  /** What the supplier is asked for, in their unit. */
  orderUnit: string;
  /** A unit of the order unit, in cents. Null when nobody knows the price. */
  unitCostCents: number | null;
  /** How the supplier was picked, for the panel. */
  how: "linked-preferred" | "linked" | "material-preferred" | "kind-match" | "none";
}

export function isYards(unit: string): boolean {
  return /^(cu(bic)?\.?\s*)?(yd|yds|yard|yards)\.?$/i.test(unit.trim()) || /cubic\s+yards?/i.test(unit);
}

/** What kind of bulk product a material is, read off its name, for suppliers whose products aren't linked yet. */
export function kindOfMaterial(name: string): string | null {
  const text = name.toLowerCase();
  if (/mulch/.test(text)) return "mulch";
  if (/topsoil|soil/.test(text)) return "topsoil";
  if (/rock|stone|gravel/.test(text)) return "stone";
  if (/compost|leaf ?gro/.test(text)) return "compost";
  if (/sand/.test(text)) return "sand";
  return null;
}

/**
 * Where a material comes from, in order of how sure we are.
 *
 * A product linked to the material and marked preferred, then any product
 * linked to it (cheapest), then the supplier named on the material itself,
 * then a supplier selling the same kind of bulk material (cheapest), then
 * nobody -- and nobody is an honest answer the panel asks a person about,
 * not a reason to pick one at random.
 */
export function resolveSource(
  material: SourcingMaterial,
  products: readonly SourcingProduct[],
  suppliers: readonly SourcingSupplier[]
): Source {
  const live = new Set(suppliers.filter((s) => s.active).map((s) => s.id));
  const usable = products.filter((p) => p.active && live.has(p.supplierId));
  const cheapest = (list: SourcingProduct[]) =>
    [...list].sort((a, b) => (a.priceCents == null ? 1 : 0) - (b.priceCents == null ? 1 : 0) || (a.priceCents ?? 0) - (b.priceCents ?? 0))[0];
  const fromProduct = (p: SourcingProduct, how: Source["how"]): Source => ({
    supplierId: p.supplierId,
    productId: p.id,
    orderUnit: p.unit,
    unitCostCents: p.priceCents,
    how,
  });

  const linked = usable.filter((p) => p.materialId === material.id);
  const preferred = linked.filter((p) => p.preferred);
  if (preferred.length) return fromProduct(cheapest(preferred), "linked-preferred");
  if (linked.length) return fromProduct(cheapest(linked), "linked");

  const ownCost = material.costPerUnit != null ? Math.round(material.costPerUnit * 100) : null;
  if (material.preferredSupplierId && live.has(material.preferredSupplierId)) {
    return { supplierId: material.preferredSupplierId, productId: null, orderUnit: material.unit, unitCostCents: ownCost, how: "material-preferred" };
  }

  const kind = isYards(material.unit) ? kindOfMaterial(material.name) : null;
  if (kind) {
    const ofKind = usable.filter((p) => p.kind === kind && p.materialId == null);
    if (ofKind.length) return fromProduct(cheapest(ofKind), "kind-match");
  }
  return { supplierId: null, productId: null, orderUnit: material.unit, unitCostCents: ownCost, how: "none" };
}

/** A quantity in the material's unit, as the supplier sells it: tons of stone, rounded up to the half. */
export function toOrderUnit(quantity: number, materialUnit: string, orderUnit: string): number {
  if (orderUnit === "ton" && isYards(materialUnit)) return Math.ceil(quantity * TONS_PER_YARD_OF_STONE * 2 - 1e-9) / 2;
  if (orderUnit === "yd" && isYards(materialUnit)) return Math.ceil(quantity * 2 - 1e-9) / 2;
  return round2(quantity);
}

/* -------------------------------------------------------------------------
 * Orders
 * ---------------------------------------------------------------------- */

export interface DraftLine {
  materialId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unit: string;
  orderQuantity: number;
  orderUnit: string;
  unitCostCents: number | null;
}

export interface DraftOrder {
  supplierId: string | null;
  lines: DraftLine[];
  fulfilment: "delivery" | "pickup";
  subtotalCents: number;
  fullyPriced: boolean;
  notes: string[];
}

/**
 * One order per supplier, with the delivery minimum respected.
 *
 * A yard can't be delivered when the yard won't deliver under three, and the
 * honest answer is a pickup, not an order padded to the minimum with mulch
 * nobody asked for. The note says so, so whoever approves it can choose to
 * top it up instead.
 */
export function groupIntoOrders(
  lines: readonly (DraftLine & { supplierId: string | null })[],
  suppliers: readonly SourcingSupplier[]
): DraftOrder[] {
  const bySupplier = new Map<string, (DraftLine & { supplierId: string | null })[]>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const k = line.supplierId ?? "";
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), line]);
  }
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const orders: DraftOrder[] = [];
  for (const [k, group] of bySupplier) {
    const supplier = k ? (supplierById.get(k) ?? null) : null;
    const notes: string[] = [];
    let fulfilment: DraftOrder["fulfilment"] = "delivery";
    if (!supplier) {
      notes.push("No supplier is set for these materials. Pick one before sending.");
    } else if (!supplier.delivers) {
      fulfilment = "pickup";
      notes.push(`${supplier.name} doesn't deliver, so this is a pickup.`);
    } else if (supplier.deliveryMinimum != null) {
      const bulk = group.filter((l) => l.orderUnit === "yd" || l.orderUnit === "ton").reduce((s, l) => s + l.orderQuantity, 0);
      if (bulk > 0 && bulk < supplier.deliveryMinimum) {
        fulfilment = "pickup";
        notes.push(
          `${round2(bulk)} is under ${supplier.name}'s ${supplier.deliveryMinimum} delivery minimum, so this is set as a pickup. Top it up to the minimum to have it delivered.`
        );
      }
    }
    const fullyPriced = group.every((l) => l.unitCostCents != null);
    const subtotalCents = group.reduce((s, l) => s + Math.round((l.unitCostCents ?? 0) * l.orderQuantity), 0);
    if (!fullyPriced) notes.push("Some lines have no price, so this order needs a person to approve it.");
    orders.push({
      supplierId: supplier?.id ?? null,
      lines: group.map((line) => ({
        materialId: line.materialId,
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        orderQuantity: line.orderQuantity,
        orderUnit: line.orderUnit,
        unitCostCents: line.unitCostCents,
      })),
      fulfilment,
      subtotalCents,
      fullyPriced,
      notes,
    });
  }
  // Orders with a supplier first, the "pick one" order last.
  return orders.sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1));
}

/** Approved on creation when it is small, fully priced and has somewhere to go. */
export function shouldAutoApprove(order: Pick<DraftOrder, "supplierId" | "fullyPriced" | "subtotalCents">, underCents: number): boolean {
  return Boolean(order.supplierId) && order.fullyPriced && order.subtotalCents < underCents;
}

/* -------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------- */

/** "2026-10-20" minus some days, as a date key. Calendar days: yards deliver on Saturdays. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** When the materials have to be in hand: some days before the first work day. Null when the job isn't scheduled. */
export function neededByDate(firstWorkDay: string | null, daysBefore: number): string | null {
  return firstWorkDay ? addDays(firstWorkDay, -Math.max(0, daysBefore)) : null;
}

export const OPEN_PO_STATUSES = ["draft", "sent", "confirmed", "partial"] as const;
export const IN_HAND_STATUSES = ["delivered", "picked_up"] as const;
export type PoStatus = "draft" | "sent" | "confirmed" | "partial" | "delivered" | "picked_up" | "cancelled";

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  partial: "Part received",
  delivered: "Delivered",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

/**
 * Whether a job's materials are late: inside the in-hand window and something
 * still not in hand. Something with no supplier at all counts as not in hand.
 */
export function materialsLate(input: {
  today: string;
  firstWorkDay: string | null;
  daysBefore: number;
  orderStatuses: readonly PoStatus[];
}): boolean {
  if (!input.firstWorkDay) return false;
  if (input.today > input.firstWorkDay) return false;
  if (input.today < addDays(input.firstWorkDay, -Math.max(0, input.daysBefore))) return false;
  return input.orderStatuses.some((s) => s !== "cancelled" && !(IN_HAND_STATUSES as readonly string[]).includes(s));
}

/* -------------------------------------------------------------------------
 * Receiving
 * ---------------------------------------------------------------------- */

/** What an order becomes after some of it arrives. */
export function statusAfterReceiving(
  lines: readonly { quantity: number; received: number }[],
  mode: "delivered" | "picked_up"
): PoStatus {
  const any = lines.some((l) => l.received > 0);
  const all = lines.length > 0 && lines.every((l) => l.received + 1e-9 >= l.quantity);
  if (all) return mode;
  return any ? "partial" : "confirmed";
}

/* -------------------------------------------------------------------------
 * Reorders
 * ---------------------------------------------------------------------- */

/**
 * How much to reorder, or null when nothing is needed.
 *
 * Below the threshold once what is already on order is counted. Orders the
 * material's own reorder quantity when it has one; otherwise enough to get
 * back to twice the threshold, which is a sensible shelf for a business that
 * hasn't said.
 */
export function reorderAmount(input: {
  onHand: number | null;
  threshold: number | null;
  onOrder: number;
  reorderQuantity: number | null;
}): number | null {
  if (input.onHand == null || input.threshold == null || input.threshold <= 0) return null;
  const position = input.onHand + Math.max(0, input.onOrder);
  if (position >= input.threshold) return null;
  if (input.reorderQuantity != null && input.reorderQuantity > 0) return round2(input.reorderQuantity);
  return round2(input.threshold * 2 - position);
}

/* -------------------------------------------------------------------------
 * The email to the supplier
 * ---------------------------------------------------------------------- */

export function poEmail(input: {
  businessName: string;
  businessPhone: string | null;
  poNumber: number;
  supplierName: string;
  fulfilment: "delivery" | "pickup";
  neededBy: string | null;
  deliverTo: string | null;
  lines: readonly { name: string; orderQuantity: number; orderUnit: string }[];
  notes: string | null;
}): { subject: string; text: string } {
  const when = input.neededBy ? ` by ${input.neededBy}` : "";
  const subject = `Purchase order ${input.poNumber} from ${input.businessName}`;
  const items = input.lines.map((l) => `- ${fmt(l.orderQuantity)} ${unitWord(l.orderUnit)} ${l.name}`).join("\n");
  const how =
    input.fulfilment === "delivery"
      ? `Please deliver${when}${input.deliverTo ? ` to ${input.deliverTo}` : ""}.`
      : `We'll pick this up${when}. Please let us know when it's ready.`;
  const text = [
    `Hi ${input.supplierName},`,
    "",
    `Please fill purchase order ${input.poNumber}:`,
    "",
    items,
    "",
    how,
    input.notes ? `\n${input.notes}` : "",
    "",
    "Reply to this email to confirm, with the total and the delivery day.",
    "",
    "Thanks,",
    input.businessName,
    input.businessPhone ?? "",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();
  return { subject, text };
}

function unitWord(unit: string): string {
  if (unit === "yd") return "yd";
  if (unit === "ton") return "ton";
  return unit;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
