"use client";

import { useState, useTransition } from "react";

import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  linkSupplierProduct,
  markPurchaseOrderConfirmed,
  markPurchaseOrderSentByHand,
  raiseReordersNow,
  receivePurchaseOrder,
  saveMaterialSourcing,
  savePurchasingSettings,
  saveSupplierEmail,
  sendPurchaseOrderNow,
  setPurchaseOrderSupplier,
  type ActionResult,
  type PurchasingSettingsPatch,
} from "@/lib/actions/purchasing-actions";
import type { PoView, PurchasingPanelData, PurchasingSettings } from "@/lib/data/purchasing";

/**
 * The buttons on the Purchasing panel. Each one calls a server action and
 * shows what it said, in words, under the button.
 */

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

function useAction() {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const result = await fn();
      setSaid(result.ok ? { ok: true, text: result.message ?? "Done." } : { ok: false, text: result.error });
    });
  return { pending, said, run };
}

function Said({ said }: { said: { ok: boolean; text: string } | null }) {
  if (!said) return null;
  return <p className={`mt-2 text-sm ${said.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}`}>{said.text}</p>;
}

/* -------------------------------------------------------------------------
 * One order's buttons
 * ---------------------------------------------------------------------- */

export function PoActions({ order, suppliers }: { order: PoView; suppliers: { id: string; name: string; email: string | null }[] }) {
  const { pending, said, run } = useAction();
  const [receiving, setReceiving] = useState(false);
  const [mode, setMode] = useState<"delivered" | "picked_up">(order.fulfilment === "pickup" ? "picked_up" : "delivered");
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, String(Math.max(0, Math.round((l.quantity - l.received) * 100) / 100))]))
  );

  const open = ["draft", "sent", "confirmed", "partial"].includes(order.status);
  if (!open) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {order.status === "draft" && !order.supplierId && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <span className="sr-only">Supplier</span>
            <select
              className="min-h-11 rounded-lg border bg-background px-2"
              defaultValue=""
              disabled={pending}
              onChange={(e) => e.target.value && run(() => setPurchaseOrderSupplier(order.id, e.target.value))}
            >
              <option value="">Pick a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {order.status === "draft" && order.supplierId && !order.approvedAt && (
          <button type="button" className={primary} disabled={pending} onClick={() => run(() => approvePurchaseOrder(order.id))}>
            Approve
          </button>
        )}
        {order.status === "draft" && order.approvedAt && (
          <button
            type="button"
            className={primary}
            disabled={pending || !order.supplierEmail}
            title={order.supplierEmail ? `Email ${order.supplierEmail}` : "This supplier has no email address"}
            onClick={() => run(() => sendPurchaseOrderNow(order.id))}
          >
            Email to supplier
          </button>
        )}
        {order.status === "draft" && order.supplierId && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => markPurchaseOrderSentByHand(order.id))}>
            I ordered it by phone
          </button>
        )}
        {order.status === "sent" && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => markPurchaseOrderConfirmed(order.id))}>
            Supplier confirmed
          </button>
        )}
        {order.status !== "draft" && (
          <button type="button" className={primary} disabled={pending} onClick={() => setReceiving((v) => !v)}>
            {receiving ? "Close" : "Record what came"}
          </button>
        )}
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Cancel PO ${order.poNumber}?`)) run(() => cancelPurchaseOrder(order.id));
          }}
        >
          Cancel
        </button>
      </div>

      {receiving && (
        <form
          className="mt-3 grid gap-2 rounded-lg bg-muted p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              receivePurchaseOrder({
                id: order.id,
                mode,
                lines: order.lines.map((l) => ({ lineId: l.id, quantity: Number(amounts[l.id] || 0) })),
              })
            );
            setReceiving(false);
          }}
        >
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`mode-${order.id}`} checked={mode === "delivered"} onChange={() => setMode("delivered")} />
              Delivered
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`mode-${order.id}`} checked={mode === "picked_up"} onChange={() => setMode("picked_up")} />
              Picked up
            </label>
          </div>
          {order.lines.map((l) => (
            <label key={l.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-sm">
              <span>
                {l.name} <span className="text-muted-foreground">· {l.received} of {l.quantity} {l.unit} in</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="min-h-11 rounded-lg border bg-background px-2"
                value={amounts[l.id] ?? ""}
                onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))}
                aria-label={`${l.name} received, in ${l.unit}`}
              />
            </label>
          ))}
          <button type="submit" className={primary} disabled={pending}>
            Add to stock
          </button>
        </form>
      )}
      <Said said={said} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Reorders
 * ---------------------------------------------------------------------- */

export function RaiseReordersButton({ count }: { count: number }) {
  const { pending, said, run } = useAction();
  return (
    <div>
      <button type="button" className={btn} disabled={pending || count === 0} onClick={() => run(() => raiseReordersNow())}>
        Draft reorders for everything low now
      </button>
      <Said said={said} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-2">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export function PurchasingSettingsForm({ settings }: { settings: PurchasingSettings }) {
  const { pending, said, run } = useAction();
  const save = (patch: PurchasingSettingsPatch) => run(() => savePurchasingSettings(patch));
  const since = (at: string | null) => (at ? ` On since ${at.slice(0, 10)}; only jobs and stock changed after that are touched.` : "");
  return (
    <div>
      <Switch
        label="Draft orders from accepted and scheduled jobs"
        hint={`Totals the estimate's materials, takes off what's in stock, and drafts one order per supplier, needed ${settings.inHandDaysBefore} days before the first work day.${since(settings.takeoffStartedAt)}`}
        checked={settings.takeoffEnabled}
        disabled={pending}
        onChange={(v) => save({ takeoffEnabled: v })}
      />
      <Switch
        label="Draft reorders when stock drops below its reorder point"
        hint={`Orders the material's reorder quantity, or back up to twice the threshold.${since(settings.reorderStartedAt)}`}
        checked={settings.reorderEnabled}
        disabled={pending}
        onChange={(v) => save({ reorderEnabled: v })}
      />
      <Switch
        label="Email approved orders to suppliers automatically"
        hint={`Off by default. Sends from your verified email domain; suppliers without an email address are left for you to phone.${since(settings.autoSendStartedAt)}`}
        checked={settings.autoSendEnabled}
        disabled={pending}
        onChange={(v) => save({ autoSendEnabled: v })}
      />
      <Switch
        label="Tell the project lead"
        hint="When orders are drafted for their job, and when materials aren't in hand in time."
        checked={settings.notifyLead}
        disabled={pending}
        onChange={(v) => save({ notifyLead: v })}
      />
      <form
        className="mt-2 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          save({ autoApproveUnderDollars: Number(data.get("approve")), inHandDaysBefore: Number(data.get("days")) });
        }}
      >
        <label className="grid gap-1 text-sm">
          <span>Auto-approve orders under ($)</span>
          <input
            name="approve"
            type="number"
            min={0}
            step={1}
            defaultValue={Math.round(settings.autoApproveUnderCents / 100)}
            className="min-h-11 w-32 rounded-lg border bg-background px-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>In hand days before work</span>
          <input name="days" type="number" min={0} max={30} defaultValue={settings.inHandDaysBefore} className="min-h-11 w-24 rounded-lg border bg-background px-2" />
        </label>
        <button type="submit" className={btn} disabled={pending}>
          Save
        </button>
      </form>
      <Said said={said} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Where things come from
 * ---------------------------------------------------------------------- */

/**
 * The three facts an order needs and the old pages had nowhere to keep: each
 * supplier's inbox, which supplier product is which of our materials (and
 * which one to order), and how much to reorder of each material.
 */
export function SourcingEditor({
  suppliers,
  sourcing,
}: {
  suppliers: PurchasingPanelData["suppliers"];
  sourcing: PurchasingPanelData["sourcing"];
}) {
  const { pending, said, run } = useAction();
  return (
    <div className="grid gap-4">
      <div>
        <h4 className="text-sm font-semibold">Supplier emails</h4>
        <ul className="mt-2 grid gap-2">
          {suppliers.map((s) => (
            <li key={s.id}>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const email = String(new FormData(e.currentTarget).get("email") ?? "");
                  run(() => saveSupplierEmail(s.id, email));
                }}
              >
                <span className="min-w-32 text-sm font-medium">{s.name}</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={s.email ?? ""}
                  placeholder="orders@supplier.com"
                  className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
                  aria-label={`${s.name} email`}
                />
                <button type="submit" className={btn} disabled={pending}>
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>

      {sourcing.products.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Supplier products → our materials</h4>
          <ul className="mt-2 grid gap-2">
            {sourcing.products.map((p) => (
              <li key={p.id} className="grid gap-2 rounded-lg bg-muted p-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-center">
                <span>
                  {p.supplierName}: {p.name} <span className="text-muted-foreground">({p.kind}, by the {p.unit})</span>
                </span>
                <select
                  className="min-h-11 rounded-lg border bg-background px-2"
                  defaultValue={p.materialId ?? ""}
                  disabled={pending}
                  aria-label={`Which material ${p.name} is`}
                  onChange={(e) => run(() => linkSupplierProduct(p.id, e.target.value || null, p.preferred))}
                >
                  <option value="">Not linked</option>
                  {sourcing.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    defaultChecked={p.preferred}
                    disabled={pending || !p.materialId}
                    onChange={(e) => run(() => linkSupplierProduct(p.id, p.materialId, e.target.checked))}
                  />
                  Preferred
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold">Materials</h4>
        <ul className="mt-2 grid gap-2">
          {sourcing.materials.map((m) => (
            <li key={m.id}>
              <form
                className="grid gap-2 rounded-lg bg-muted p-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_7rem_auto] sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const raw = String(data.get("qty") ?? "").trim();
                  run(() =>
                    saveMaterialSourcing(m.id, {
                      preferredSupplierId: String(data.get("supplier") ?? "") || null,
                      reorderQuantity: raw === "" ? null : Number(raw),
                    })
                  );
                }}
              >
                <span>
                  <span className="font-medium">{m.name}</span>
                  <span className="block text-xs text-muted-foreground">Orders from: {m.source}</span>
                </span>
                <select name="supplier" defaultValue={m.preferredSupplierId ?? ""} className="min-h-11 rounded-lg border bg-background px-2" aria-label={`${m.name} usual supplier`}>
                  <option value="">Usual supplier: any</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  name="qty"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={m.reorderQuantity ?? ""}
                  placeholder={`Reorder ${m.unit}`}
                  className="min-h-11 rounded-lg border bg-background px-2"
                  aria-label={`${m.name} reorder quantity in ${m.unit}`}
                />
                <button type="submit" className={btn} disabled={pending}>
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
      <Said said={said} />
    </div>
  );
}
