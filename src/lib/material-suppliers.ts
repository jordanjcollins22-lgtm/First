/**
 * Bulk suppliers for a job's material: which is closest with a price, what
 * the material and delivery come to, and any closer one we have no price
 * for, which is worth a call.
 *
 * Distance is a straight line from the job, in miles: enough to rank
 * suppliers a few miles apart, not a drive time. Pure, so it is tested
 * without a database.
 */

import type { ProductionService } from "@/lib/forward-pricing";

export const SUPPLIER_KINDS = ["mulch", "topsoil", "stone", "compost", "sand", "other"] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

export interface SupplierProduct {
  id: string;
  kind: SupplierKind;
  name: string;
  unit: "yd" | "ton";
  /** Picked up, in cents. Null when the supplier doesn't publish one. */
  priceCents: number | null;
  /** Delivered, a unit, when they charge more for it; the delivery fee is on top. */
  deliveredPriceCents: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  checkedOn: string | null;
}

export interface DeliveryFee {
  town: string;
  zips: string[];
  feeCents: number;
}

export interface Supplier {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  delivers: boolean;
  /** The smallest delivery, in yards or tons. */
  deliveryMinimum: number | null;
  deliveryFees: DeliveryFee[];
  deliveryNote: string | null;
  notes: string | null;
  sourceUrl: string | null;
  checkedOn: string | null;
  /** Off: kept, but not recommended. */
  active: boolean;
  products: SupplierProduct[];
}

/** About how many tons a cubic yard of stone weighs, for stone sold by the ton. */
export const TONS_PER_YARD_OF_STONE = 1.4;

/** The bulk material a service uses, from its key and material: mulch install uses mulch. */
export function supplierKindFor(service: Pick<ProductionService, "key" | "materialName" | "unit">): SupplierKind | null {
  if (service.unit !== "CY") return null;
  const text = `${service.key} ${service.materialName ?? ""}`.toLowerCase();
  if (/mulch/.test(text)) return "mulch";
  if (/topsoil|soil/.test(text)) return "topsoil";
  if (/rock|stone|gravel/.test(text)) return "stone";
  if (/compost|leaf ?gro/.test(text)) return "compost";
  if (/sand/.test(text)) return "sand";
  return null;
}

/** Straight-line miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The five-digit zip code at the end of an address, if it has one. */
export function zipOf(address: string | null | undefined): string | null {
  const all = (address ?? "").match(/\b\d{5}(?:-\d{4})?\b/g);
  return all ? all[all.length - 1].slice(0, 5) : null;
}

/** What the supplier charges to deliver to a zip code, when it says. */
export function deliveryFeeFor(supplier: Supplier, zip: string | null): DeliveryFee | null {
  if (!zip) return null;
  return supplier.deliveryFees.find((f) => f.zips.includes(zip)) ?? null;
}

export interface SupplierOption {
  supplier: Supplier;
  /** From the job, in a straight line. Null when either has no position. */
  miles: number | null;
  /** What it sells of the kind, priced ones first, cheapest first. */
  products: SupplierProduct[];
  /** The cheapest priced product, or null when none has a price. */
  product: SupplierProduct | null;
  /** How much of it, in the product's unit: yards, or tons for stone sold by the ton. */
  amount: number;
  amountUnit: "yd" | "ton";
  /** Delivery to the job's zip code, when the supplier publishes it. */
  delivery: DeliveryFee | null;
  /** Under the supplier's delivery minimum: pick it up, or pay for the minimum. */
  underMinimum: boolean;
  /** The material delivered, delivery fee in, in cents; null without a price. Picked up when there is no delivery price. */
  costCents: number | null;
}

export interface SupplierPick {
  /** The closest supplier with a price for the material. */
  recommended: SupplierOption | null;
  /** Suppliers closer than that which sell it but have no price we know: call them. */
  closerToCall: SupplierOption[];
  /** Every supplier that sells it, closest first. */
  all: SupplierOption[];
}

/** A product's price a unit: delivered when there is a delivery fee and a delivered price, else picked up. */
function unitPrice(product: SupplierProduct, delivery: DeliveryFee | null): number | null {
  if (product.priceCents == null) return null;
  return delivery && product.deliveredPriceCents != null ? product.deliveredPriceCents : product.priceCents;
}

/** What one of an option's products comes to for the job, delivery fee in, in cents. Null without a price. */
export function costWith(option: SupplierOption, product: SupplierProduct): number | null {
  const unit = unitPrice(product, option.delivery);
  if (unit == null) return null;
  const raw = product.unit === option.amountUnit ? option.amount : product.unit === "ton" ? option.amount * TONS_PER_YARD_OF_STONE : option.amount / TONS_PER_YARD_OF_STONE;
  return Math.round(unit * (Math.ceil(raw * 2 - 1e-9) / 2) + (option.delivery?.feeCents ?? 0));
}

/**
 * The suppliers of a kind of material for a job, closest first, and the one
 * to use: the closest with a price. Without the job's position they are in
 * the order given, and the cheapest priced one is recommended.
 */
export function pickSupplier(suppliers: Supplier[], kind: SupplierKind, yards: number, site: { lat: number; lng: number; zip: string | null } | null): SupplierPick {
  const options: SupplierOption[] = suppliers.flatMap((supplier) => {
    if (!supplier.active) return [];
    const ofKind = supplier.products.filter((p) => p.kind === kind);
    if (ofKind.length === 0) return [];
    const products = [...ofKind].sort((a, b) => (a.priceCents == null ? 1 : 0) - (b.priceCents == null ? 1 : 0) || (a.priceCents ?? 0) - (b.priceCents ?? 0));
    const product = products.find((p) => p.priceCents != null) ?? null;
    const amountUnit = product?.unit ?? products[0].unit;
    const raw = amountUnit === "ton" ? yards * TONS_PER_YARD_OF_STONE : yards;
    // Ordered to the next half.
    const amount = Math.ceil(raw * 2 - 1e-9) / 2;
    const miles = site && supplier.lat != null && supplier.lng != null ? milesBetween(site, { lat: supplier.lat, lng: supplier.lng }) : null;
    const delivery = deliveryFeeFor(supplier, site?.zip ?? null);
    const unitCents = product ? unitPrice(product, delivery) : null;
    return [
      {
        supplier,
        miles,
        products,
        product,
        amount,
        amountUnit,
        delivery,
        underMinimum: supplier.deliveryMinimum != null && amount < supplier.deliveryMinimum,
        costCents: unitCents != null ? Math.round(unitCents * amount + (delivery?.feeCents ?? 0)) : null,
      },
    ];
  });
  const all = site ? [...options].sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity)) : options;
  const recommended = site ? (all.find((o) => o.product) ?? null) : ([...options].filter((o) => o.costCents != null).sort((a, b) => a.costCents! - b.costCents!)[0] ?? null);
  const closerToCall = site ? (recommended ? all.slice(0, all.indexOf(recommended)) : all).filter((o) => !o.product) : [];
  return { recommended, closerToCall, all };
}

/** A supplier as sent from the Suppliers page, checked: what is saved. */
export interface SupplierInput {
  id: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  delivers: boolean;
  deliveryMinimum: number | null;
  deliveryFees: DeliveryFee[];
  deliveryNote: string | null;
  notes: string | null;
  sourceUrl: string | null;
  checkedOn: string | null;
  active: boolean;
  products: (Omit<SupplierProduct, "id" | "checkedOn"> & { id: string | null; checkedOn: string | null })[];
}

const UUID = /^[0-9a-f-]{36}$/i;
const text = (v: unknown, max = 300) => {
  const t = String(v ?? "").trim().slice(0, max);
  return t === "" ? null : t;
};
const url = (v: unknown) => {
  const t = text(v, 600);
  return t && /^https?:\/\/\S+$/i.test(t) ? t : null;
};
const cents = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
};
const day = (v: unknown) => {
  const t = text(v, 10);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/** The Suppliers page's form, made safe, or what is wrong with it. */
export function readSupplier(input: unknown): { ok: true; supplier: SupplierInput } | { ok: false; error: string } {
  const o = (input ?? {}) as Record<string, unknown>;
  const name = text(o.name, 120);
  if (!name) return { ok: false, error: "Give the supplier a name." };
  const minimum = o.deliveryMinimum === "" || o.deliveryMinimum == null ? null : Number(o.deliveryMinimum);
  if (minimum != null && !(Number.isFinite(minimum) && minimum > 0 && minimum <= 1000)) return { ok: false, error: "The delivery minimum is a number of yards or tons." };
  const fees: DeliveryFee[] = [];
  for (const raw of Array.isArray(o.deliveryFees) ? o.deliveryFees : []) {
    const f = (raw ?? {}) as Record<string, unknown>;
    const zips = (Array.isArray(f.zips) ? f.zips : String(f.zips ?? "").split(/[\s,]+/)).map((z) => String(z).trim()).filter(Boolean);
    const fee = cents(f.feeCents);
    if (zips.length === 0 && fee == null && !text(f.town)) continue;
    if (zips.length === 0 || !zips.every((z) => /^\d{5}$/.test(z))) return { ok: false, error: `Delivery to ${text(f.town) ?? "a town"}: give its 5-digit zip codes.` };
    if (fee == null) return { ok: false, error: `Delivery to ${text(f.town) ?? zips[0]}: give the fee.` };
    fees.push({ town: text(f.town, 60) ?? zips[0], zips, feeCents: fee });
  }
  const products: SupplierInput["products"] = [];
  for (const raw of Array.isArray(o.products) ? o.products : []) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const pname = text(p.name, 120);
    if (!pname) continue;
    const kind = String(p.kind ?? "");
    if (!(SUPPLIER_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `Pick what ${pname} is: mulch, topsoil, stone…` };
    products.push({
      id: typeof p.id === "string" && UUID.test(p.id) ? p.id : null,
      kind: kind as SupplierKind,
      name: pname,
      unit: p.unit === "ton" ? "ton" : "yd",
      priceCents: cents(p.priceCents),
      deliveredPriceCents: cents(p.deliveredPriceCents),
      imageUrl: url(p.imageUrl),
      productUrl: url(p.productUrl),
      checkedOn: day(p.checkedOn),
    });
  }
  return {
    ok: true,
    supplier: {
      id: typeof o.id === "string" && UUID.test(o.id) ? o.id : null,
      name,
      address: text(o.address, 200),
      phone: text(o.phone, 40),
      website: url(o.website),
      delivers: o.delivers !== false,
      deliveryMinimum: minimum,
      deliveryFees: fees,
      deliveryNote: text(o.deliveryNote, 500),
      notes: text(o.notes, 500),
      sourceUrl: url(o.sourceUrl),
      checkedOn: day(o.checkedOn),
      active: o.active !== false,
      products,
    },
  };
}
