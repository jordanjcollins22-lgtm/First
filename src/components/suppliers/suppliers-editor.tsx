"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveSupplier } from "@/lib/actions/supplier-actions";
import { SUPPLIER_KINDS, type Supplier } from "@/lib/material-suppliers";
import { cn } from "@/lib/utils";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Dollars typed, as cents; empty is none. */
const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
const toDollars = (c: number | null) => (c == null ? "" : String(c / 100));

interface Draft {
  id: string | null;
  name: string;
  address: string;
  phone: string;
  website: string;
  delivers: boolean;
  deliveryMinimum: string;
  deliveryFees: { town: string; zips: string; fee: string }[];
  deliveryNote: string;
  notes: string;
  sourceUrl: string;
  checkedOn: string;
  active: boolean;
  products: { id: string | null; kind: string; name: string; unit: "yd" | "ton"; price: string; delivered: string; imageUrl: string; productUrl: string }[];
}

const draftOf = (s: Supplier): Draft => ({
  id: s.id,
  name: s.name,
  address: s.address ?? "",
  phone: s.phone ?? "",
  website: s.website ?? "",
  delivers: s.delivers,
  deliveryMinimum: s.deliveryMinimum == null ? "" : String(s.deliveryMinimum),
  deliveryFees: s.deliveryFees.map((f) => ({ town: f.town, zips: f.zips.join(", "), fee: toDollars(f.feeCents) })),
  deliveryNote: s.deliveryNote ?? "",
  notes: s.notes ?? "",
  sourceUrl: s.sourceUrl ?? "",
  checkedOn: s.checkedOn ?? "",
  active: s.active,
  products: s.products.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    unit: p.unit,
    price: toDollars(p.priceCents),
    delivered: toDollars(p.deliveredPriceCents),
    imageUrl: p.imageUrl ?? "",
    productUrl: p.productUrl ?? "",
  })),
});

const blank = (): Draft => ({
  id: null,
  name: "",
  address: "",
  phone: "",
  website: "",
  delivers: true,
  deliveryMinimum: "3",
  deliveryFees: [],
  deliveryNote: "",
  notes: "",
  sourceUrl: "",
  checkedOn: new Date().toISOString().slice(0, 10),
  active: true,
  products: [],
});

/**
 * Every bulk supplier, each opened to change its address, delivery fees by
 * town, minimum and what it sells by the yard or ton. Saved one at a time.
 */
export function SuppliersEditor({ initial, available, canEdit }: { initial: Supplier[]; available: boolean; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<Draft[]>(initial.map(draftOf));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-16">
      <div>
        <h1 className="text-xl font-semibold">Bulk suppliers</h1>
        <p className="text-sm text-muted-foreground">
          Where to get mulch, topsoil and stone near the work. When a job&apos;s material is over its bulk threshold, the price card recommends the closest supplier
          here with a price, adds its delivery fee to that town, and names any closer one without a price to call. Prices change: keep the date checked current.
        </p>
      </div>
      {!available && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Suppliers can&apos;t be kept yet: database update 0339 hasn&apos;t been applied.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {drafts.map((d, i) => (
          <li key={d.id ?? `new-${i}`} className={cn("rounded-2xl border border-border bg-card", !d.active && "opacity-60")}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-3 p-3 text-left">
              {open === i ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{d.name || "New supplier"}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[d.address, d.phone, `${d.products.length} product${d.products.length === 1 ? "" : "s"}`, d.products.some((p) => p.price) ? null : "no prices", d.active ? null : "off"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {d.checkedOn && <span className="shrink-0 text-xs text-muted-foreground">checked {d.checkedOn}</span>}
            </button>
            {open === i && (
              <SupplierForm
                draft={d}
                disabled={!canEdit || !available}
                onChange={(next) => setDrafts((all) => all.map((x, j) => (j === i ? next : x)))}
              />
            )}
          </li>
        ))}
      </ul>
      {canEdit && available && (
        <button
          type="button"
          onClick={() => {
            setDrafts((all) => [...all, blank()]);
            setOpen(drafts.length);
          }}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary"
        >
          <Plus className="h-4 w-4" /> Add a supplier
        </button>
      )}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs text-muted-foreground", wide && "md:col-span-2")}>
      {label}
      {children}
    </label>
  );
}

const input = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function SupplierForm({ draft: d, disabled, onChange }: { draft: Draft; disabled: boolean; onChange: (d: Draft) => void }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<Draft>) => {
    onChange({ ...d, ...patch });
    setMessage(null);
  };
  const save = () =>
    start(async () => {
      const result = await saveSupplier({
        ...d,
        deliveryMinimum: d.deliveryMinimum,
        deliveryFees: d.deliveryFees.map((f) => ({ town: f.town, zips: f.zips, feeCents: toCents(f.fee) })),
        products: d.products.map((p) => ({ ...p, priceCents: toCents(p.price), deliveredPriceCents: toCents(p.delivered) })),
      });
      if (result.ok) {
        onChange({ ...d, id: result.id });
        setMessage({ ok: true, text: "Saved" });
      } else setMessage({ ok: false, text: result.error });
    });

  return (
    <div className="flex flex-col gap-4 border-t border-border p-3">
      <fieldset disabled={disabled || pending} className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Address (placed on the map from this)">
          <input className={input} value={d.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className={input} value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Website">
          <input className={input} value={d.website} placeholder="https://" onChange={(e) => set({ website: e.target.value })} />
        </Field>
        <Field label="Prices read from (link)">
          <input className={input} value={d.sourceUrl} placeholder="https://" onChange={(e) => set({ sourceUrl: e.target.value })} />
        </Field>
        <Field label="Date the prices were checked">
          <input type="date" className={input} value={d.checkedOn} onChange={(e) => set({ checkedOn: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.delivers} onChange={(e) => set({ delivers: e.target.checked })} /> Delivers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> On (recommended on price cards)
        </label>
      </fieldset>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Delivery</h3>
        <fieldset disabled={disabled || pending} className="grid gap-3 md:grid-cols-2">
          <Field label="Delivery minimum (yards or tons)">
            <input type="number" step="any" min={0} className={input} value={d.deliveryMinimum} onChange={(e) => set({ deliveryMinimum: e.target.value })} />
          </Field>
          <Field label="Delivery note (what the fee table can't say)">
            <input className={input} value={d.deliveryNote} onChange={(e) => set({ deliveryNote: e.target.value })} />
          </Field>
        </fieldset>
        {d.deliveryFees.length > 0 && (
          <div className="grid grid-cols-[1fr_1fr_6rem_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Town</span>
            <span>Zip codes</span>
            <span>Fee ($)</span>
            <span className="w-6" />
          </div>
        )}
        <ul className="flex flex-col gap-1.5">
          {d.deliveryFees.map((f, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_6rem_auto] items-center gap-2">
              <input className={input} disabled={disabled} value={f.town} placeholder="Town" aria-label="Town" onChange={(e) => set({ deliveryFees: d.deliveryFees.map((x, j) => (j === i ? { ...x, town: e.target.value } : x)) })} />
              <input className={input} disabled={disabled} value={f.zips} placeholder="Zip codes" aria-label="Zip codes" onChange={(e) => set({ deliveryFees: d.deliveryFees.map((x, j) => (j === i ? { ...x, zips: e.target.value } : x)) })} />
              <input className={input} disabled={disabled} type="number" step="any" min={0} value={f.fee} placeholder="$ fee" aria-label="Fee in dollars" onChange={(e) => set({ deliveryFees: d.deliveryFees.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)) })} />
              {!disabled && (
                <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`Remove delivery to ${f.town}`} onClick={() => set({ deliveryFees: d.deliveryFees.filter((_, j) => j !== i) })}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!disabled && (
          <button type="button" onClick={() => set({ deliveryFees: [...d.deliveryFees, { town: "", zips: "", fee: "" }] })} className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary">
            <Plus className="h-3.5 w-3.5" /> Add a town&apos;s delivery fee
          </button>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">What they sell</h3>
        {d.products.length > 0 && (
          <div className="hidden gap-2 pl-[3.5rem] pr-14 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[7rem_1fr_4.5rem_5.5rem_5.5rem]">
            <span>Kind</span>
            <span>Name</span>
            <span>Sold by</span>
            <span>$ picked up</span>
            <span>$ delivered</span>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {d.products.map((p, i) => {
            const setP = (patch: Partial<Draft["products"][number]>) => set({ products: d.products.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <li key={p.id ?? `p-${i}`} className="flex flex-col gap-2 rounded-lg border border-border p-2 md:flex-row md:items-center">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <span className="hidden h-12 w-12 shrink-0 rounded-md bg-muted md:block" aria-hidden />
                )}
                <fieldset disabled={disabled || pending} className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-[7rem_1fr_4.5rem_5.5rem_5.5rem]">
                  <select className={input} value={p.kind} aria-label="Kind" onChange={(e) => setP({ kind: e.target.value })}>
                    {SUPPLIER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <input className={input} value={p.name} placeholder="Name" aria-label="Product name" onChange={(e) => setP({ name: e.target.value })} />
                  <select className={input} value={p.unit} aria-label="Sold by" onChange={(e) => setP({ unit: e.target.value === "ton" ? "ton" : "yd" })}>
                    <option value="yd">/yd</option>
                    <option value="ton">/ton</option>
                  </select>
                  <input className={input} type="number" step="any" min={0} value={p.price} placeholder="$ picked up" aria-label="Price picked up" onChange={(e) => setP({ price: e.target.value })} />
                  <input className={input} type="number" step="any" min={0} value={p.delivered} placeholder="$ delivered" aria-label="Price delivered" onChange={(e) => setP({ delivered: e.target.value })} />
                  <input className={cn(input, "col-span-2 md:col-span-2")} value={p.imageUrl} placeholder="Photo link (https://…)" aria-label="Photo link" onChange={(e) => setP({ imageUrl: e.target.value })} />
                  <input className={cn(input, "col-span-2 md:col-span-3")} value={p.productUrl} placeholder="Product page (https://…)" aria-label="Product page" onChange={(e) => setP({ productUrl: e.target.value })} />
                </fieldset>
                <div className="flex shrink-0 items-center gap-1">
                  {p.productUrl && (
                    <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`Open ${p.name}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  {!disabled && (
                    <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${p.name}`} onClick={() => set({ products: d.products.filter((_, j) => j !== i) })}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!disabled && (
          <button
            type="button"
            onClick={() => set({ products: [...d.products, { id: null, kind: "mulch", name: "", unit: "yd", price: "", delivered: "", imageUrl: "", productUrl: "" }] })}
            className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add a product
          </button>
        )}
        {d.products.some((p) => p.price) && (
          <p className="text-xs text-muted-foreground">
            Cheapest: {d.products.filter((p) => p.price).map((p) => `${p.name} ${money(toCents(p.price)!)}/${p.unit}`).sort((a, b) => a.localeCompare(b)).slice(0, 3).join(" · ")}
          </p>
        )}
      </section>

      <Field label="Notes" wide>
        <textarea className={cn(input, "h-16 py-1.5")} disabled={disabled} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      {!disabled && (
        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending} className="h-10 px-5 font-semibold">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save supplier
          </Button>
          {message && (
            <span className={cn("flex items-center gap-1.5 text-sm", message.ok ? "text-emerald-700" : "text-destructive")}>
              {message.ok && <CheckCircle2 className="h-4 w-4" />} {message.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
