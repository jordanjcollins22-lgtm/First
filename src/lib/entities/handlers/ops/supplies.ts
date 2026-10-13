import type { ActionResult, EntityAction, EntityHandler, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { attempt, cents, dayLabel, dollars, outstandingLines, parseNumber, poActions, stampLabel, toResult, words } from "@/lib/entities/ops-helpers";
import { jobNames, many, own, str, todayKey, type Row } from "@/lib/entities/handlers/ops/common";
import { PO_STATUS_LABEL, type PoStatus } from "@/lib/purchasing/takeoff";

import {
  deactivateMaterial,
  setMaterialOnOrder,
  updateMaterialQuantityOnHand,
  updateMaterialReorderThreshold,
} from "@/lib/actions/material-actions";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  markPurchaseOrderConfirmed,
  markPurchaseOrderSentByHand,
  raiseReordersNow,
  receivePurchaseOrder,
  saveSupplierEmail,
  sendPurchaseOrderNow,
  setPurchaseOrderSupplier,
} from "@/lib/actions/purchasing-actions";
import { archiveContainer, markOnOrder, reportBroken } from "@/lib/actions/kit-container-actions";
import { logEquipmentUsage, recordService } from "@/lib/actions/equipment-actions";
import { recordBreakdown, retireAsset } from "@/lib/actions/fleet-actions";
import { deactivateTool, setToolOnOrder, updateToolQuantity, updateToolReorderThreshold } from "@/lib/actions/tool-actions";

/**
 * What the jobs use and what the crews carry: materials, suppliers, purchase
 * orders, kit containers, the fleet and the tools.
 */

const NOT_YOURS: ActionResult = { ok: false, error: "That isn't one of yours." };
const qty = (n: unknown) => {
  const v = Number(n);
  return n == null || !Number.isFinite(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
};
const poLabel = (s: unknown) => PO_STATUS_LABEL[str(s) as PoStatus] ?? words(s);

/** A number typed for a count or a threshold: blank clears it, nonsense and negatives are refused. */
function amount(value: string | undefined): { ok: true; n: number | null } | { ok: false; error: string } {
  const n = parseNumber(value);
  if (n != null && (Number.isNaN(n) || n < 0)) return { ok: false, error: "Enter a number, zero or more." };
  return { ok: true, n };
}

/* ------------------------------------------------------------- material */

const material: EntityHandler = {
  kind: "ops.material",

  async load(ctx, id) {
    const m = await own(ctx, "materials", "*", id);
    if (!m) return null;
    const [lines, products] = await Promise.all([
      many(ctx, "purchase_order_lines", "purchase_order_id, quantity, received_quantity, unit", (q) => q.eq("material_id", id).limit(100)),
      many(ctx, "supplier_products", "id, supplier_id, name, price_cents, unit, preferred", (q) => q.eq("material_id", id)),
    ]);
    const poIds = [...new Set(lines.map((l) => str(l.purchase_order_id)))];
    const supplierIds = [...new Set([...products.map((p) => str(p.supplier_id)), str(m.preferred_supplier_id)].filter(Boolean))];
    const [orders, suppliers] = await Promise.all([
      poIds.length ? many(ctx, "purchase_orders", "id, po_number, status, created_at", (q) => q.in("id", poIds).order("created_at", { ascending: false }).limit(20)) : Promise.resolve([] as Row[]),
      supplierIds.length ? many(ctx, "material_suppliers", "id, name", (q) => q.in("id", supplierIds)) : Promise.resolve([] as Row[]),
    ]);
    const supplierName = new Map(suppliers.map((s) => [str(s.id), str(s.name)]));
    const onHand = m.quantity_on_hand == null ? null : Number(m.quantity_on_hand);
    const threshold = m.reorder_threshold == null ? null : Number(m.reorder_threshold);
    const low = onHand != null && threshold != null && onHand < threshold;
    const unit = str(m.unit);

    const actions: EntityAction[] = [
      { id: "quantity", label: "Adjust quantity on hand", input: { type: "number", label: `On hand (${unit || "units"})`, initial: onHand == null ? "" : String(onHand) } },
      { id: "reorder_point", label: "Set reorder point", input: { type: "number", label: `Reorder below (${unit || "units"})`, initial: threshold == null ? "" : String(threshold) } },
    ];
    if (low && !m.on_order) {
      actions.push({
        id: "draft_reorder",
        label: "Draft a reorder",
        tone: "primary",
        confirm: "Draft a purchase order for this? Any other material below its reorder point with nothing on order is drafted too.",
      });
    }
    actions.push({ id: "on_order", label: m.on_order ? "Mark not on order" : "Mark on order" });
    if (m.active) actions.push({ id: "deactivate", label: "Stop using this material", tone: "danger", confirm: "Take this material off the list? Past jobs keep it." });

    return {
      title: str(m.name),
      subtitle: [words(m.category), unit].filter((s) => s && s !== "—").join(" · ") || undefined,
      status: !m.active ? "Not in use" : low ? "Below reorder point" : m.on_order ? "On order" : "Stocked",
      fields: [
        { label: "On hand", value: onHand == null ? "Not counted" : `${qty(onHand)} ${unit}` },
        { label: "Reorder below", value: threshold == null ? "Not set" : `${qty(threshold)} ${unit}` },
        { label: "Reorder quantity", value: m.reorder_quantity == null ? "Up to the reorder point" : `${qty(m.reorder_quantity)} ${unit}` },
        { label: "On order", value: m.on_order ? "Yes" : "No" },
        { label: "Preferred supplier", value: supplierName.get(str(m.preferred_supplier_id)) ?? "" },
        { label: "Stocked how", value: m.stock_method === "order_as_needed" ? "Ordered for each job" : "Kept in stock" },
        { label: "Where it's kept", value: [str(m.storage_location), str(m.shop_location)].filter(Boolean).join(" · ") },
        { label: "Cost per unit", value: m.cost_per_unit == null ? "" : dollars(m.cost_per_unit) },
      ],
      sections: [
        { title: "Purchase orders", rows: orders.map((o) => row(`PO ${o.po_number} · ${poLabel(o.status)} · ${dayLabel(str(o.created_at).slice(0, 10))}`, "ops.po", o.id)), empty: "Never ordered on a purchase order." },
        {
          title: "Who sells it",
          rows: products.map((p) => row(`${supplierName.get(str(p.supplier_id)) ?? "Supplier"} · ${str(p.name)}${p.price_cents != null ? ` · ${cents(p.price_cents)}/${str(p.unit)}` : ""}${p.preferred ? " · preferred" : ""}`, "ops.supplier", p.supplier_id)),
          empty: "No supplier product linked to it.",
        },
      ],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const m = await own(ctx, "materials", "id, on_order", id);
    if (!m) return NOT_YOURS;
    switch (action) {
      case "quantity": {
        const a = amount(value);
        if (!a.ok) return a;
        return attempt(() => updateMaterialQuantityOnHand(id, a.n), a.n == null ? "Count cleared." : `On hand is now ${qty(a.n)}.`);
      }
      case "reorder_point": {
        const a = amount(value);
        if (!a.ok) return a;
        return attempt(() => updateMaterialReorderThreshold(id, a.n), a.n == null ? "Reorder point cleared." : `Reorders below ${qty(a.n)}.`);
      }
      case "draft_reorder":
        return toResult(await raiseReordersNow());
      case "on_order":
        return attempt(() => setMaterialOnOrder(id, !m.on_order), m.on_order ? "Not on order." : "Marked on order.");
      case "deactivate":
        return attempt(() => deactivateMaterial(id), "Taken off the list.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------------- supplier */

const supplier: EntityHandler = {
  kind: "ops.supplier",

  async load(ctx, id) {
    const s = await own(ctx, "material_suppliers", "*", id);
    if (!s) return null;
    const [products, orders] = await Promise.all([
      many(ctx, "supplier_products", "id, name, kind, unit, price_cents, material_id, preferred, active", (q) => q.eq("supplier_id", id).order("sort")),
      many(ctx, "purchase_orders", "id, po_number, status, subtotal_cents, created_at", (q) => q.eq("supplier_id", id).order("created_at", { ascending: false }).limit(25)),
    ]);
    return {
      title: str(s.name),
      subtitle: str(s.address) || undefined,
      status: s.active === false ? "Not in use" : undefined,
      fields: [
        { label: "Order email", value: str(s.email) || "None, so orders can't be emailed" },
        { label: "Phone", value: str(s.phone) },
        { label: "Website", value: str(s.website) },
        { label: "Delivers", value: s.delivers ? `Yes${s.delivery_minimum ? `, ${qty(s.delivery_minimum)} yd minimum` : ""}` : "No, pickup only" },
        { label: "Delivery", value: str(s.delivery_note) },
        { label: "Notes", value: str(s.notes) },
        { label: "Prices checked", value: s.checked_on ? dayLabel(s.checked_on) : "" },
      ],
      sections: [
        {
          title: "Products",
          rows: products.map((p) => {
            const text = `${str(p.name)}${p.price_cents != null ? ` · ${cents(p.price_cents)}/${str(p.unit)}` : ""}${p.preferred ? " · preferred" : ""}`;
            return p.material_id ? row(text, "ops.material", p.material_id) : { text };
          }),
          empty: "No products on file.",
        },
        { title: "Purchase orders", rows: orders.map((o) => row(`PO ${o.po_number} · ${poLabel(o.status)} · ${cents(o.subtotal_cents)}`, "ops.po", o.id)), empty: "Nothing ordered from them yet." },
      ],
      actions: [{ id: "email", label: "Set order email", input: { type: "email", label: "Where purchase orders go", initial: str(s.email) } }],
    };
  },

  async act(ctx, id, action, value) {
    if (!(await own(ctx, "material_suppliers", "id", id))) return NOT_YOURS;
    if (action === "email") return toResult(await saveSupplierEmail(id, value ?? ""));
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------- purchase order */

const purchaseOrder: EntityHandler = {
  kind: "ops.po",

  async load(ctx, id) {
    const p = await own(ctx, "purchase_orders", "*, purchase_order_lines(*)", id);
    if (!p) return null;
    const [suppliers, names] = await Promise.all([
      many(ctx, "material_suppliers", "id, name, email, active", (q) => q.order("name")),
      jobNames(ctx, [p.job_id]),
    ]);
    const supplierRow = suppliers.find((s) => s.id === p.supplier_id);
    const lines = ((p.purchase_order_lines ?? []) as Row[]).map((l) => ({
      id: str(l.id),
      materialId: str(l.material_id),
      name: str(l.name),
      quantity: Number(l.quantity),
      unit: str(l.unit),
      orderQuantity: l.order_quantity == null ? null : Number(l.order_quantity),
      orderUnit: str(l.order_unit),
      received: Number(l.received_quantity ?? 0),
      unitCostCents: l.unit_cost_cents == null ? null : Number(l.unit_cost_cents),
    }));
    const status = str(p.status);
    const can = poActions({ status, approvedAt: (p.approved_at as string | null) ?? null, supplierId: (p.supplier_id as string | null) ?? null });

    const actions: EntityAction[] = [];
    if (can.includes("approve")) actions.push({ id: "approve", label: "Approve", tone: "primary" });
    if (can.includes("send")) actions.push({ id: "send", label: `Send to ${str(supplierRow?.name) || "the supplier"}`, tone: "primary", confirm: "Email this order to the supplier now?" });
    if (status === "draft") {
      const choices = suppliers.filter((s) => s.active !== false).map((s) => ({ value: str(s.id), label: str(s.name) }));
      if (choices.length) actions.push({ id: "supplier", label: p.supplier_id ? "Change supplier" : "Pick a supplier", input: { type: "select", label: "Supplier", options: choices, initial: str(p.supplier_id), required: true } });
    }
    if (can.includes("sent_by_hand")) actions.push({ id: "sent_by_hand", label: "Ordered by phone or online", confirm: "Record this as ordered without emailing it?" });
    if (can.includes("confirm")) actions.push({ id: "confirm", label: "Supplier confirmed it" });
    if (can.includes("receive")) {
      actions.push({
        id: "receive",
        label: "Receive everything still to come",
        tone: "primary",
        input: { type: "select", label: "How it came", options: [{ value: "delivered", label: "Delivered" }, { value: "picked_up", label: "Picked up" }], initial: p.fulfilment === "pickup" ? "picked_up" : "delivered", required: true },
      });
    }
    if (can.includes("cancel")) actions.push({ id: "cancel", label: "Cancel order", tone: "danger", confirm: "Cancel this purchase order?" });

    const lineRows: EntityRow[] = lines.map((l) => {
      const text = `${qty(l.orderQuantity ?? l.quantity)} ${l.orderUnit || l.unit} ${l.name}${l.received > 0 ? ` · ${qty(l.received)} of ${qty(l.quantity)} ${l.unit} in` : ""}${l.unitCostCents == null ? " · no price" : ""}`;
      return l.materialId ? row(text, "ops.material", l.materialId) : { text };
    });
    const related: EntityRow[] = [];
    if (p.supplier_id) related.push(row(str(supplierRow?.name) || "Supplier", "ops.supplier", p.supplier_id));
    if (p.job_id) related.push(row(names.get(str(p.job_id)) ?? "Job", "ops.job", p.job_id));

    return {
      title: `PO ${p.po_number}`,
      subtitle: str(supplierRow?.name) || "No supplier yet",
      status: poLabel(status),
      fields: [
        { label: "For", value: p.source === "reorder" ? "Restocking" : p.job_id ? (names.get(str(p.job_id)) ?? "A job") : "By hand" },
        { label: "Fulfilment", value: p.fulfilment === "pickup" ? "Pickup" : "Delivery" },
        { label: "Needed by", value: p.needed_by ? dayLabel(p.needed_by) : "" },
        { label: "Subtotal", value: `${cents(p.subtotal_cents)}${p.fully_priced ? "" : " + unpriced lines"}` },
        { label: "Approved", value: p.approved_at ? `${stampLabel(p.approved_at)}${p.auto_approved ? " (automatically)" : ""}` : "Not yet" },
        { label: "Sent", value: p.sent_at ? `${stampLabel(p.sent_at)}${p.sent_via ? ` · ${str(p.sent_via)}` : ""}` : "Not yet" },
        ...(p.send_error ? [{ label: "Last send failed", value: str(p.send_error) }] : []),
        { label: "Notes", value: str(p.notes) },
      ],
      sections: [
        { title: "Lines", rows: lineRows, empty: "No lines." },
        { title: "Supplier and job", rows: related, empty: "No supplier picked." },
      ],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const p = await own(ctx, "purchase_orders", "id, status, purchase_order_lines(id, quantity, received_quantity)", id);
    if (!p) return NOT_YOURS;
    switch (action) {
      case "approve":
        return toResult(await approvePurchaseOrder(id));
      case "send":
        return toResult(await sendPurchaseOrderNow(id));
      case "supplier":
        if (!value) return { ok: false, error: "Pick a supplier." };
        return toResult(await setPurchaseOrderSupplier(id, value));
      case "sent_by_hand":
        return toResult(await markPurchaseOrderSentByHand(id));
      case "confirm":
        return toResult(await markPurchaseOrderConfirmed(id));
      case "receive": {
        if (value !== "delivered" && value !== "picked_up") return { ok: false, error: "Say whether it was delivered or picked up." };
        const lines = outstandingLines(((p.purchase_order_lines ?? []) as Row[]).map((l) => ({ id: str(l.id), quantity: Number(l.quantity), received: Number(l.received_quantity ?? 0) })));
        if (!lines.length) return { ok: false, error: "Everything on it is already in." };
        return toResult(await receivePurchaseOrder({ id, mode: value, lines }));
      }
      case "cancel":
        return toResult(await cancelPurchaseOrder(id));
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------- kit container */

const kit: EntityHandler = {
  kind: "ops.kit",

  async load(ctx, id) {
    const k = await own(ctx, "kit_containers", "*", id);
    if (!k) return null;
    const parts = await many(ctx, "kit_container_parts", "id, name, quantity, broken, on_order", (q) => q.eq("container_id", id).order("position"));
    const broken = Number(k.broken ?? 0);
    const actions: EntityAction[] = [
      { id: "broken", label: "Report broken", input: { type: "number", label: "How many are broken", initial: String(broken), required: true } },
      { id: "on_order", label: k.on_order ? "Replacement not on order" : "Replacement ordered" },
      k.archived_at
        ? { id: "unarchive", label: "Bring it back" }
        : { id: "archive", label: "Archive", tone: "danger", confirm: "Archive this container? Kits stop listing it." },
    ];
    return {
      title: str(k.name),
      subtitle: k.code ? `Code ${str(k.code)}` : undefined,
      status: k.archived_at ? "Archived" : broken > 0 ? `${broken} broken` : "In use",
      fields: [
        { label: "Kits", value: Array.isArray(k.kits) && k.kits.length ? (k.kits as number[]).join(", ") : "" },
        { label: "Bought or built", value: words(k.kind) },
        { label: "How many", value: k.quantity == null ? "" : qty(k.quantity) },
        { label: "Broken", value: String(broken) },
        { label: "On order", value: k.on_order ? "Yes" : "No" },
        { label: "Reorder below", value: k.reorder_threshold == null ? "" : qty(k.reorder_threshold) },
        { label: "Cost", value: k.cost == null ? "" : dollars(k.cost) },
        { label: "Notes", value: str(k.notes) },
      ],
      sections: [
        {
          title: "Parts",
          rows: parts.map((pt) => ({ text: `${qty(pt.quantity)} × ${str(pt.name)}${Number(pt.broken) > 0 ? ` · ${pt.broken} broken` : ""}${pt.on_order ? " · on order" : ""}` })),
          empty: "Bought whole, no parts listed.",
        },
      ],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const k = await own(ctx, "kit_containers", "id, on_order", id);
    if (!k) return NOT_YOURS;
    switch (action) {
      case "broken": {
        const a = amount(value);
        if (!a.ok) return a;
        return toResult(await reportBroken({ containerId: id, partId: null, broken: a.n ?? 0 }), "Saved.");
      }
      case "on_order":
        return toResult(await markOnOrder({ containerId: id, partId: null, onOrder: !k.on_order }), k.on_order ? "Not on order." : "Marked on order.");
      case "archive":
        return toResult(await archiveContainer({ id, archived: true }), "Archived.");
      case "unarchive":
        return toResult(await archiveContainer({ id, archived: false }), "Back in use.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ---------------------------------------------------- vehicle/equipment */

const asset: EntityHandler = {
  kind: "ops.asset",

  async load(ctx, id) {
    const a = await own(ctx, "fleet_assets", "*", id);
    if (!a) return null;
    const [services, alerts] = await Promise.all([
      many(ctx, "equipment_service_records", "task, done_on, at_hours, at_miles, cost_cents", (q) => q.eq("asset_id", id).order("done_on", { ascending: false }).limit(10)),
      many(ctx, "equipment_alerts", "task, summary, state", (q) => q.eq("asset_id", id).eq("state", "open")),
    ]);
    const meter = str(a.meter) || "none";
    const actions: EntityAction[] = [];
    if (!a.retired_on) {
      actions.push({
        id: "service",
        label: "Log service",
        tone: "primary",
        input: { type: "text", label: "What was done today", placeholder: str(alerts[0]?.task) || "Oil change", initial: str(alerts[0]?.task), required: true },
      });
      actions.push({
        id: "hours",
        label: meter === "miles" ? "Log mileage" : "Log hours",
        input: {
          type: "number",
          label: meter === "miles" ? "Odometer now" : meter === "hours" ? "Hour meter now" : "Hours it ran today",
          initial: meter === "miles" && a.mileage != null ? String(a.mileage) : meter === "hours" && a.engine_hours != null ? String(a.engine_hours) : "",
          required: true,
        },
      });
      actions.push({ id: "breakdown", label: "It broke down today", confirm: "Record a breakdown today?" });
      actions.push({ id: "retire", label: "Retire", tone: "danger", confirm: "Retire this from the fleet?" });
    } else {
      actions.push({ id: "unretire", label: "Put back in service" });
    }
    return {
      title: str(a.name),
      subtitle: [a.year ? String(a.year) : "", str(a.make), str(a.model)].filter(Boolean).join(" ") || words(a.kind),
      status: a.retired_on ? `Retired ${dayLabel(a.retired_on)}` : alerts.length ? `${alerts.length} service due` : words(a.condition),
      fields: [
        { label: "Kind", value: words(a.kind) },
        { label: "Condition", value: words(a.condition) },
        { label: "Mileage", value: a.mileage == null ? "" : Number(a.mileage).toLocaleString("en-US") },
        { label: "Engine hours", value: a.engine_hours == null ? "" : String(a.engine_hours) },
        { label: "Breakdowns (12 months)", value: String(a.breakdowns_12mo ?? 0) },
        { label: "Last breakdown", value: a.last_breakdown_on ? dayLabel(a.last_breakdown_on) : "" },
        { label: "Costs a month", value: a.monthly_cost == null ? "" : dollars(a.monthly_cost) },
        { label: "Notes", value: str(a.notes) },
      ],
      sections: [
        { title: "Service due", rows: alerts.map((al) => ({ text: str(al.summary) || str(al.task) })), empty: "Nothing due." },
        {
          title: "Service log",
          rows: services.map((s) => ({ text: `${dayLabel(s.done_on)} · ${str(s.task)}${s.at_hours != null ? ` · ${s.at_hours}h` : ""}${s.at_miles != null ? ` · ${Number(s.at_miles).toLocaleString("en-US")} mi` : ""}${s.cost_cents != null ? ` · ${cents(s.cost_cents)}` : ""}` })),
          empty: "No service logged.",
        },
      ],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const a = await own(ctx, "fleet_assets", "id, meter", id);
    if (!a) return NOT_YOURS;
    switch (action) {
      case "service":
        return toResult(await recordService({ assetId: id, task: value ?? "", doneOn: todayKey() }));
      case "hours": {
        const n = parseNumber(value);
        if (n == null || Number.isNaN(n) || n < 0) return { ok: false, error: "Enter a number." };
        const meter = str(a.meter) || "none";
        return toResult(await logEquipmentUsage([meter === "none" ? { assetId: id, usedHours: n } : { assetId: id, reading: n }]));
      }
      case "breakdown":
        return toResult(await recordBreakdown({ id }), "Breakdown recorded.");
      case "retire":
        return toResult(await retireAsset({ id, retired: true }), "Retired.");
      case "unretire":
        return toResult(await retireAsset({ id, retired: false }), "Back in service.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ----------------------------------------------------------------- tool */

const tool: EntityHandler = {
  kind: "ops.tool",

  async load(ctx, id) {
    const t = await own(ctx, "tools", "*", id);
    if (!t) return null;
    const quantity = t.quantity == null ? null : Number(t.quantity);
    const threshold = t.reorder_threshold == null ? null : Number(t.reorder_threshold);
    const actions: EntityAction[] = [
      { id: "quantity", label: "Adjust how many we have", input: { type: "number", label: "How many", initial: quantity == null ? "" : String(quantity) } },
      { id: "reorder_point", label: "Set reorder point", input: { type: "number", label: "Reorder below", initial: threshold == null ? "" : String(threshold) } },
      { id: "on_order", label: t.on_order ? "Mark not on order" : "Mark on order" },
    ];
    if (t.active) actions.push({ id: "deactivate", label: "Stop using this tool", tone: "danger", confirm: "Take this tool off the inventory?" });
    return {
      title: str(t.name),
      subtitle: words(t.category),
      status: !t.active ? "Not in use" : t.is_rental ? "Rented" : quantity != null && threshold != null && quantity < threshold ? "Below reorder point" : "Owned",
      fields: [
        { label: "How many", value: quantity == null ? "Not counted" : qty(quantity) },
        { label: "Reorder below", value: threshold == null ? "Not set" : qty(threshold) },
        { label: "On order", value: t.on_order ? "Yes" : "No" },
        { label: "Kits", value: Array.isArray(t.kits) && t.kits.length ? (t.kits as number[]).join(", ") : "" },
        { label: "Where it's kept", value: [str(t.storage_location), str(t.shop_location)].filter(Boolean).join(" · ") },
        { label: "Cost", value: t.cost == null ? "" : dollars(t.cost) },
        ...(t.is_rental ? [{ label: "Why we rent it", value: str(t.not_owned_reason) }] : []),
        { label: "About", value: str(t.description) },
      ],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const t = await own(ctx, "tools", "id, on_order", id);
    if (!t) return NOT_YOURS;
    switch (action) {
      case "quantity": {
        const a = amount(value);
        if (!a.ok) return a;
        return attempt(() => updateToolQuantity(id, a.n), "Saved.");
      }
      case "reorder_point": {
        const a = amount(value);
        if (!a.ok) return a;
        return attempt(() => updateToolReorderThreshold(id, a.n), "Saved.");
      }
      case "on_order":
        return attempt(() => setToolOnOrder(id, !t.on_order), t.on_order ? "Not on order." : "Marked on order.");
      case "deactivate":
        return attempt(() => deactivateTool(id), "Taken off the inventory.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

export const OPS_SUPPLY_HANDLERS: EntityHandler[] = [material, supplier, purchaseOrder, kit, asset, tool];
