"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Images, Plus, X } from "lucide-react";

import {
  crewRateCents,
  priceForward,
  productionService,
  projectCostMargin,
  revenueAllocation,
  scopeGaps,
  servicesByGroup,
  type PriceLine,
  type PricedJob,
  type PricedLine,
  type PricingEquation,
  type ScopeGap,
} from "@/lib/forward-pricing";
import type { PriceApproval } from "@/lib/data/price-approvals";
import { bulkOrders, jobMaterials, priceFromSuppliers, purchaseNoun, type InventoryItem, type MaterialRow, type SuppliedOrder } from "@/lib/forward-materials";
import { costWith, pickSupplier, type Supplier, type SupplierPick, type SupplierProduct } from "@/lib/material-suppliers";
import { PriceSiteMap } from "@/components/proposal/price-site-map";
import { cn } from "@/lib/utils";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
/** The forward-priced job for these lines, with the business's own rates. */
export function priceLines(item: PriceApproval, lines: PriceLine[][]): PricedJob {
  return priceForward(lines, item.pricing.equation, item.pricing.services, item.driveMinutesPerDay);
}

/** Areas whose services come to nothing, by name: the price can't be accepted with them. */
export function unpricedAreas(item: PriceApproval, lines: PriceLine[][]): string[] {
  const job = priceLines(item, lines);
  return item.breakdown.areas.filter((_, i) => (job.areas[i]?.rCents ?? 0) <= 0).map((a) => a.name);
}

/**
 * Each area's gaps between the walkthrough and its lines, keyed "area:gap" so
 * a tick survives the lines changing around it.
 */
export function areaGaps(item: PriceApproval, lines: PriceLine[][]): { key: string; area: number; gap: ScopeGap }[] {
  return (item.forward ?? []).flatMap((f, a) => (f.facts ? scopeGaps(f.facts, lines[a] ?? [], item.pricing.services).map((gap) => ({ key: `${a}:${gap.id}`, area: a, gap })) : []));
}

/** The gaps nobody has fixed or ticked off yet: the price can't be accepted with them. */
export function openGaps(item: PriceApproval, lines: PriceLine[][], checked: string[]): string[] {
  return areaGaps(item, lines)
    .filter((g) => !checked.includes(g.key))
    .map((g) => g.key);
}

/**
 * The price, built the forward way and shown all the way through: each area
 * on the left with what it is, what the evaluator wrote and its photos (tap
 * to go through them all), and on the right every service it needs, each at
 * its own production rate: Q, PR, PLH, PLC, M and R. Then the job's totals
 * and where the price goes. Quantities and costs can be changed, services
 * removed and added; the price follows.
 */
export function ForwardBreakdown({
  item,
  lines,
  onChange,
  locked = false,
  checked = [],
  onCheck,
}: {
  item: PriceApproval;
  lines: PriceLine[][];
  onChange: (lines: PriceLine[][]) => void;
  locked?: boolean;
  /** Gaps ticked off as looked at and not needed, by "area:gap". */
  checked?: string[];
  onCheck?: (key: string, on: boolean) => void;
}) {
  const job = priceLines(item, lines);
  const gaps = areaGaps(item, lines);
  const { equation: eq, services } = item.pricing;
  const [gallery, setGallery] = useState<{ area: number; index: number } | null>(null);
  const forward = item.forward ?? [];

  // Bulk materials are priced from the closest supplier on every change, so they follow the quantities with no clicks.
  const suppliers = item.suppliers ?? [];
  const site = item.site ?? null;
  const change = (next: PriceLine[][]) => onChange(priceFromSuppliers(next, services, suppliers, site).lines);
  const supplied = priceFromSuppliers(lines, services, suppliers, site).orders;
  const setLine = (area: number, index: number, patch: Partial<PriceLine>) => {
    // M typed by hand stays as typed, rather than being repriced from the supplier.
    const typed = patch.materialCents !== undefined && patch.quantity === undefined ? { supplied: false } : {};
    change(lines.map((ls, a) => (a === area ? ls.map((l, i) => (i === index ? { ...l, ...patch, ...typed, note: patch.quantity !== undefined || patch.materialCents !== undefined ? null : l.note } : l)) : ls)));
  };
  const removeLine = (area: number, index: number) => change(lines.map((ls, a) => (a === area ? ls.filter((_, i) => i !== index) : ls)));
  const setOrder = (rows: { area: number; line: number }[], patch: Partial<PriceLine>) =>
    change(lines.map((ls, a) => ls.map((l, i) => (rows.some((r) => r.area === a && r.line === i) ? { ...l, ...patch } : l))));
  const addLine = (area: number, key: string) => {
    const service = productionService(key, services);
    if (!service) return;
    const size = Number(String(item.breakdown.areas[area]?.size ?? "").replace(/[^0-9.]/g, "")) || 0;
    const quantity = service.unit === "SF" ? size : service.unit === "job" ? 1 : 0;
    const materialCents = service.materialCentsPerUnit ? Math.round(quantity * service.materialCentsPerUnit) : 0;
    change(lines.map((ls, a) => (a === area ? [...ls, { key, quantity, materialCents, note: quantity === 0 ? "Type how many." : null }] : ls)));
  };

  return (
    <div className="flex flex-col gap-3">
      {item.siteMap && <PriceSiteMap map={item.siteMap} />}

      {item.breakdown.areas.map((area, a) => {
        const priced = job.areas[a];
        const thumbs = item.areaPhotos[a] ?? [];
        const pins = forward[a]?.markers ?? [];
        // Lead with the photo the evaluator pinned the work on.
        const cover = Math.min(forward[a]?.cover ?? 0, Math.max(0, thumbs.length - 1));
        const others = thumbs.map((src, i) => ({ src, i })).filter((t) => t.i !== cover);
        return (
          <section key={`${area.name}-${a}`} className="overflow-hidden rounded-xl border border-border">
            <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              {/* What it is, and what it looks like. */}
              <div className="flex flex-col gap-2 border-b border-border bg-muted/30 p-3 md:border-b-0 md:border-r">
                <p className="flex items-start gap-1.5 font-semibold leading-tight">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{a + 1}</span>
                  <span>
                    {area.name}
                    <span className="block text-sm font-normal text-muted-foreground">{area.service}</span>
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{area.size ?? "Not measured"}</p>
                {forward[a]?.notes && <p className="text-sm italic">&ldquo;{forward[a].notes}&rdquo;</p>}
                {thumbs.length > 0 ? (
                  <>
                    <button type="button" className="relative block overflow-hidden rounded-lg" onClick={() => setGallery({ area: a, index: cover })} aria-label={`See all ${thumbs.length} photos of ${area.name}`}>
                      {/* The whole photo, never cropped, so the pins land on the work they were dropped on. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbs[cover]} alt={`${area.name} on the walkthrough`} className="block w-full bg-muted" loading="lazy" />
                      <Pins points={pins[cover] ?? []} />
                      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                        <Images className="h-3.5 w-3.5" /> {thumbs.length} photo{thumbs.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    {(pins[cover] ?? []).length === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">No pin on this photo: it was taken before pins were required.</p>}
                    {others.length > 0 && (
                      <div className="grid grid-cols-4 gap-1">
                        {others.slice(0, 4).map((t) => (
                          <button key={t.src} type="button" onClick={() => setGallery({ area: a, index: t.i })} aria-label={`Photo ${t.i + 1} of ${area.name}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={t.src} alt="" className="aspect-square w-full rounded-md bg-muted object-cover" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No photos taken of this area.</p>
                )}
              </div>

              {/* Every service it needs, worked through. */}
              <div className="min-w-0 p-3">
                <AreaGaps gaps={gaps.filter((g) => g.area === a)} checked={checked} onCheck={onCheck} locked={locked} />
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-1 pr-2 text-left font-medium">Service</th>
                        <th className="px-2 py-1 text-right font-medium">Q</th>
                        <th className="px-2 py-1 text-right font-medium">PR</th>
                        <th className="px-2 py-1 text-right font-medium">PLH</th>
                        <th className="px-2 py-1 text-right font-medium">PLC</th>
                        <th className="px-2 py-1 text-right font-medium">M</th>
                        <th className="py-1 pl-2 text-right font-medium">R</th>
                        {!locked && <th className="w-6" aria-label="Remove" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {priced.lines.map((l, i) => {
                        const missing = l.quantity === 0 && l.unit !== "job";
                        return (
                          <tr key={`${l.key}-${i}`} className={cn(missing && "bg-amber-50 dark:bg-amber-950/30")}>
                            <td className="py-1.5 pr-2 align-top">
                              <span className="font-medium">{l.label}</span>
                              {l.note && <span className={cn("block text-xs", missing ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{l.note}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right align-top tabular-nums">
                              {locked || l.unit === "job" ? (
                                `${qty(l.quantity)}${l.unit === "job" ? "" : ` ${l.unit}`}`
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <QuantityInput line={l} perUnit={productionService(l.key, services)?.materialCentsPerUnit} onChange={(patch) => setLine(a, i, patch)} />
                                  <span className="text-xs text-muted-foreground">{l.unit}</span>
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums text-muted-foreground">{l.pr != null ? `${qty(l.pr)}/hr` : "—"}</td>
                            <td className="px-2 py-1.5 text-right align-top tabular-nums">{l.pr != null ? l.plh.toFixed(2) : "—"}</td>
                            <td className="px-2 py-1.5 text-right align-top tabular-nums">{l.pr != null ? money(Math.round(l.plcCents)) : "—"}</td>
                            <td className="px-2 py-1.5 text-right align-top tabular-nums">
                              {locked ? (
                                l.materialCents > 0 ? money(l.materialCents) : "—"
                              ) : (
                                <MoneyInput line={l} onChange={(patch) => setLine(a, i, patch)} />
                              )}
                            </td>
                            <td className="py-1.5 pl-2 text-right align-top font-semibold tabular-nums">{money(l.rCents)}</td>
                            {!locked && (
                              <td className="py-1.5 pl-1 text-right align-top">
                                <button type="button" onClick={() => removeLine(a, i)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${l.label}`}>
                                  <X className="h-4 w-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {priced.lines.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-2 text-sm text-amber-800 dark:text-amber-300">
                            No services yet. Add what this area needs.
                          </td>
                        </tr>
                      )}
                      {priced.offWork.plh > 0 && (
                        <tr className="text-muted-foreground">
                          <td className="py-1.5 pr-2 align-top">
                            <span className="font-medium text-foreground">Travel and time off the work</span>
                            <span className="block text-xs">{offWorkWhy(job.offWork)}, shared by crew-hours</span>
                          </td>
                          <td />
                          <td />
                          <td className="px-2 py-1.5 text-right align-top tabular-nums">{priced.offWork.plh.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right align-top tabular-nums">{money(Math.round(priced.offWork.plcCents))}</td>
                          <td className="px-2 py-1.5 text-right align-top">—</td>
                          <td className="py-1.5 pl-2 text-right align-top font-semibold tabular-nums text-foreground">{money(priced.offWork.rCents)}</td>
                          {!locked && <td />}
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="py-1.5 pr-2">{area.name} total</td>
                        <td />
                        <td />
                        <td className="px-2 py-1.5 text-right tabular-nums">{priced.plh.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(Math.round(priced.plcCents))}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(priced.materialCents)}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">{money(priced.rCents)}</td>
                        {!locked && <td />}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-col divide-y divide-border md:hidden">
                  {priced.lines.map((l, i) => {
                    const missing = l.quantity === 0 && l.unit !== "job";
                    return (
                      <li key={`${l.key}-${i}`} className={cn("flex flex-col gap-1.5 py-2", missing && "-mx-3 bg-amber-50 px-3 dark:bg-amber-950/30")}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-sm">
                            <span className="font-medium">{l.label}</span>
                            {l.note && <span className={cn("block text-xs", missing ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{l.note}</span>}
                          </p>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-sm font-semibold tabular-nums">{money(l.rCents)}</span>
                            {!locked && (
                              <button type="button" onClick={() => removeLine(a, i)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Remove ${l.label}`}>
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            Q{" "}
                            {locked || l.unit === "job" ? (
                              <span className="text-foreground tabular-nums">{qty(l.quantity)}</span>
                            ) : (
                              <QuantityInput line={l} perUnit={productionService(l.key, services)?.materialCentsPerUnit} onChange={(patch) => setLine(a, i, patch)} />
                            )}
                            {l.unit !== "job" && l.unit}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            M {locked ? <span className="text-foreground tabular-nums">{money(l.materialCents)}</span> : <MoneyInput line={l} onChange={(patch) => setLine(a, i, patch)} />}
                          </span>
                        </div>
                        {l.pr != null && (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            PR {qty(l.pr)} {l.unit}/hr · PLH {l.plh.toFixed(2)} · PLC {money(Math.round(l.plcCents))}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {priced.lines.length === 0 && <li className="py-2 text-sm text-amber-800 dark:text-amber-300">No services yet. Add what this area needs.</li>}
                  {priced.offWork.plh > 0 && (
                    <li className="flex justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">Travel and time off the work</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {offWorkWhy(job.offWork)} · PLH {priced.offWork.plh.toFixed(2)} · PLC {money(Math.round(priced.offWork.plcCents))}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(priced.offWork.rCents)}</span>
                    </li>
                  )}
                  <li className="flex justify-between gap-2 py-2 text-sm font-semibold">
                    <span>
                      {area.name} total
                      <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                        PLH {priced.plh.toFixed(2)} · PLC {money(Math.round(priced.plcCents))} · M {money(priced.materialCents)}
                      </span>
                    </span>
                    <span className="tabular-nums">{money(priced.rCents)}</span>
                  </li>
                </ul>
                {!locked && (
                  <label className="mt-2 flex max-w-full items-center gap-1.5 text-sm text-primary md:inline-flex">
                    <Plus className="h-4 w-4" />
                    <select
                      value=""
                      onChange={(e) => addLine(a, e.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground md:h-8 md:flex-none"
                      aria-label={`Add a service to ${area.name}`}
                    >
                      <option value="">Add a service…</option>
                      {servicesByGroup(services).map(({ group, services: inGroup }) => (
                        <optgroup key={group} label={group}>
                          {inGroup.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                              {s.pr != null ? ` (${qty(s.pr)} ${s.unit}/hr)` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <ForwardMaterials
        rows={jobMaterials(item.breakdown.areas.map((a) => a.name), lines, services, item.inventory ?? [])}
        suppliers={suppliers}
        site={site}
        supplied={supplied}
        onOrder={locked ? undefined : setOrder}
      />

      <JobTotals job={job} eq={eq} />

      {gallery && forward[gallery.area] && (
        <Gallery
          title={`${item.breakdown.areas[gallery.area].name} · ${item.breakdown.areas[gallery.area].service}`}
          photos={forward[gallery.area].photos.length > 0 ? forward[gallery.area].photos : (item.areaPhotos[gallery.area] ?? [])}
          thumbs={item.areaPhotos[gallery.area] ?? []}
          pins={forward[gallery.area].markers ?? []}
          start={gallery.index}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  );
}

/** Q, typed. A service with a material per unit keeps its material in step. */
function QuantityInput({ line, perUnit, onChange }: { line: PricedLine; perUnit?: number; onChange: (patch: Partial<PriceLine>) => void }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={line.quantity === 0 ? "" : line.quantity}
      placeholder="0"
      onChange={(e) => {
        const quantity = Math.max(0, Number(e.target.value) || 0);
        const per = perUnit;
        onChange(per ? { quantity, materialCents: Math.round(quantity * per) } : { quantity });
      }}
      aria-label={`${line.label} quantity`}
      className="h-8 w-20 rounded-md border border-input bg-background px-1.5 text-right text-sm text-foreground tabular-nums"
    />
  );
}

/** M, typed in dollars. */
function MoneyInput({ line, onChange }: { line: PricedLine; onChange: (patch: Partial<PriceLine>) => void }) {
  return (
    <span className="inline-flex items-center">
      <span className="mr-0.5 text-muted-foreground">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={line.materialCents === 0 ? "" : line.materialCents / 100}
        placeholder="0"
        onChange={(e) => onChange({ materialCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })}
        aria-label={`${line.label} materials`}
        className="h-8 w-20 rounded-md border border-input bg-background px-1.5 text-right text-sm text-foreground tabular-nums"
      />
    </span>
  );
}

/** The job, added up, and where every dollar of the price goes. */
/**
 * Every material going in, with its photo, how much to buy and a link to
 * buy it. One with nowhere to buy it, or not in the inventory at all, says
 * so and links to the inventory, where the link goes.
 */
function ForwardMaterials({
  rows,
  suppliers,
  site,
  supplied,
  onOrder,
}: {
  rows: MaterialRow[];
  suppliers: Supplier[];
  site: PriceApproval["site"];
  supplied: SuppliedOrder[];
  onOrder?: (rows: { area: number; line: number }[], patch: Partial<PriceLine>) => void;
}) {
  if (rows.length === 0) return null;
  const { orders, rest } = bulkOrders(rows);
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Materials and where to buy them</p>
      <ul className="divide-y divide-border">
        {orders.map((o) => {
          const sold = suppliers.some((s) => s.products.some((p) => p.kind === o.kind));
          const yards = Math.ceil(o.quantity * 2 - 1e-9) / 2;
          const byBag = o.rows.flatMap((r) => r.items).find((i) => i.buy);
          return (
            <li key={o.kind} className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-start md:gap-4">
              <div className="min-w-0 md:w-64 md:shrink-0">
                <p className="text-sm font-medium">{o.material} for the whole job</p>
                <p className="text-xs text-muted-foreground">
                  {qty(Math.round(o.quantity * 100) / 100)} {o.unit} in all: {o.rows.map((r) => `${r.areaName} ${qty(r.quantity)}`).join(", ")}
                </p>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Over {qty(o.over)} {unitWords(o.unit)}: one order from a bulk supplier
                </p>
                {sold ? (
                  <SupplierChoice
                    pick={pickSupplier(suppliers, o.kind, o.quantity, site)}
                    hasSite={site != null}
                    inUse={new Set((supplied.find((x) => x.order.kind === o.kind)?.products ?? []).flatMap((p) => (p ? [p.id] : [])))}
                    handTyped={o.rows.filter((r) => supplied.find((x) => x.order.kind === o.kind)?.products[o.rows.indexOf(r)] === null).map((r) => r.areaName)}
                    onPick={onOrder ? (product) => onOrder(o.rows, { prefer: product.name, supplied: true }) : undefined}
                    onReprice={onOrder ? () => onOrder(o.rows, { supplied: true }) : undefined}
                  />
                ) : (
                  <p className="text-sm">
                    Order {yards} cu yd.{" "}
                    <Link href="/admin/suppliers" className="text-amber-800 underline underline-offset-2 dark:text-amber-300">
                      No supplier with {o.kind} yet
                    </Link>
                    .
                  </p>
                )}
                {byBag && o.rows.length === 1 && (
                  <p className="text-xs text-muted-foreground">
                    By the bag it would be {byBag.buy!.text} of {byBag.item.name}.
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {rest.map((r, i) => (
          <li key={i} className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-start md:gap-4">
            <div className="min-w-0 md:w-64 md:shrink-0">
              <p className="text-sm font-medium">{r.material}</p>
              <p className="text-xs text-muted-foreground">
                {r.service}, {r.areaName} · {qty(r.quantity)} {r.unit}
                {r.materialCents > 0 && <> · M {money(r.materialCents)}</>}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {r.bulk ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    Over {qty(r.bulk.over)} {unitWords(r.unit)}: order from a bulk supplier
                  </p>
                  {r.bulk.item ? (
                    <MaterialItem item={r.bulk.item} line={`Order ${r.bulk.amount}`} action="Order" />
                  ) : (
                    <p className="text-sm">
                      Order {r.bulk.amount}.{" "}
                      <Link href="/admin/production-rates" className="text-amber-800 underline underline-offset-2 dark:text-amber-300">
                        No bulk supplier picked yet
                      </Link>
                      .
                    </p>
                  )}
                  {r.items.find((i) => i.buy) && (
                    <p className="text-xs text-muted-foreground">
                      By the bag it would be {r.items.find((i) => i.buy)!.buy!.text} of {r.items.find((i) => i.buy)!.item.name}.
                    </p>
                  )}
                </>
              ) : r.items.length === 0 ? (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Not in the inventory yet.{" "}
                  <Link href="/admin/materials" className="font-medium underline underline-offset-2">
                    Add it with a link to buy it
                  </Link>
                  .
                </p>
              ) : (
                r.items.map(({ item, buy }) => (
                  <MaterialItem
                    key={item.id}
                    item={item}
                    line={buy ? `Buy ${buy.text}` : null}
                    missing={buy ? null : `How much one ${purchaseNoun(item)} holds isn't set`}
                    action="Buy"
                  />
                ))
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const miles = (m: number | null) => (m == null ? null : `${m < 10 ? m.toFixed(1) : Math.round(m)} mi`);

/**
 * The closest bulk supplier with a price: its products with their photo and
 * price, what delivery to the job costs, and a button to price the line with
 * it. A closer supplier we have no price for is named, with its phone, to
 * call; the rest are listed by distance.
 */
function SupplierChoice({
  pick,
  hasSite,
  inUse,
  handTyped,
  onPick,
  onReprice,
}: {
  pick: SupplierPick;
  hasSite: boolean;
  /** The products the price is using now. */
  inUse: Set<string>;
  /** Areas whose material cost was typed by hand, so isn't following the supplier. */
  handTyped: string[];
  onPick?: (product: SupplierProduct) => void;
  onReprice?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rec = pick.recommended;
  const others = pick.all.filter((o) => o !== rec && !pick.closerToCall.includes(o));
  return (
    <div className="flex flex-col gap-2">
      {rec ? (
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-sm">
            <span className="font-semibold">{rec.supplier.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {hasSite ? `closest with a price${rec.miles != null ? `, ${miles(rec.miles)}` : ""}` : "cheapest with a price (no position for this job)"}
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {rec.products.map((p) => {
              const cost = costWith(rec, p);
              return (
                <li key={p.id} className="flex items-center gap-3">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-md border border-border bg-white object-cover" />
                  ) : (
                    <span className="h-11 w-11 shrink-0 rounded-md bg-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {p.productUrl ? (
                        <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        p.name
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {p.priceCents != null ? `${money(p.priceCents)}/${p.unit}` : "No price"}
                      {p.deliveredPriceCents != null && ` (${money(p.deliveredPriceCents)} delivered)`}
                      {cost != null && ` · ${qty(rec.amount)} ${rec.amountUnit}${rec.delivery ? ` + ${money(rec.delivery.feeCents)} delivery` : ""} = ${money(cost)}`}
                    </p>
                  </div>
                  {inUse.has(p.id) ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                      <Check className="h-3.5 w-3.5" /> In the price
                    </span>
                  ) : (
                    onPick &&
                    p.priceCents != null && (
                      <button type="button" onClick={() => onPick(p)} className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-muted">
                        Use instead
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {rec.delivery
              ? `Delivery to ${rec.delivery.town}: ${money(rec.delivery.feeCents)}.`
              : rec.supplier.delivers
                ? `Delivery fee to this job isn't published${rec.supplier.phone ? `: call ${rec.supplier.phone}` : ""}.`
                : "Pick up only."}
            {rec.supplier.deliveryMinimum != null && ` ${qty(rec.supplier.deliveryMinimum)} ${rec.amountUnit} delivery minimum.`}
            {rec.underMinimum && " This is under it: pick it up, or pay for the minimum."}
            {rec.supplier.checkedOn && ` Prices as of ${rec.supplier.checkedOn}.`}
          </p>
          {rec.supplier.deliveryNote && <p className="mt-1 text-xs text-muted-foreground">{rec.supplier.deliveryNote}</p>}
        </div>
      ) : (
        <p className="text-sm text-amber-800 dark:text-amber-300">No supplier has a price for this yet.</p>
      )}
      {handTyped.length > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          M was typed by hand on {handTyped.join(", ")}, so it isn&apos;t following the supplier.{" "}
          {onReprice && (
            <button type="button" onClick={onReprice} className="font-medium underline underline-offset-2">
              Price it from the supplier
            </button>
          )}
        </p>
      )}
      {pick.closerToCall.map((o) => (
        <p key={o.supplier.id} className="text-sm text-amber-800 dark:text-amber-300">
          {o.supplier.name} is {rec ? "closer" : "nearby"}
          {o.miles != null && ` (${miles(o.miles)})`} but we have no price: call
          {o.supplier.phone ? (
            <>
              {" "}
              <a href={`tel:${o.supplier.phone.replace(/[^0-9+]/g, "")}`} className="font-medium underline underline-offset-2">
                {o.supplier.phone}
              </a>
            </>
          ) : (
            " them"
          )}
          .
        </p>
      ))}
      {others.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-primary">
            {open ? "Hide" : "Show"} {others.length} other supplier{others.length === 1 ? "" : "s"}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              {others.map((o) => (
                <li key={o.supplier.id}>
                  <span className="font-medium text-foreground">{o.supplier.name}</span>
                  {o.miles != null && ` · ${miles(o.miles)}`}
                  {o.product ? ` · ${o.product.name} ${money(o.product.priceCents!)}/${o.product.unit}` : " · no price"}
                  {o.costCents != null && ` · ${money(o.costCents)} for this job`}
                  {o.supplier.phone && ` · ${o.supplier.phone}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const unitWords = (u: string) => (u === "SF" ? "sq ft" : u === "CY" ? "cu yd" : u === "LF" ? "linear ft" : `${u}s`);

/** One thing to buy: its photo, name, how many, and a link to buy or order it. */
function MaterialItem({ item, line, missing = null, action }: { item: InventoryItem; line: string | null; missing?: string | null; action: string }) {
  return (
    <div className="flex items-center gap-3">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-md border border-border bg-white object-contain" />
      ) : (
        <span className="h-11 w-11 shrink-0 rounded-md bg-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        {line && <p className="text-sm font-semibold">{line}</p>}
        <p className="line-clamp-2 text-sm">{item.name}</p>
        {missing && (
          <Link href="/admin/production-rates" className="text-xs text-amber-800 underline underline-offset-2 dark:text-amber-300">
            {missing}
          </Link>
        )}
      </div>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-muted"
        >
          {action} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <Link href="/admin/materials" className="shrink-0 text-xs text-amber-800 underline underline-offset-2 dark:text-amber-300">
          No link yet
        </Link>
      )}
    </div>
  );
}

/** Why the time off the work is what it is, in words. */
function offWorkWhy(off: PricedJob["offWork"]): string {
  const days = `${off.days} day${off.days === 1 ? "" : "s"}`;
  if (off.by === "drive") return `${off.driveMinutesPerDay} min drive there and back × ${days}`;
  return `the rest of ${days} at ${qty(off.workHoursPerDay)} hrs of work a day${off.driveMinutesPerDay != null ? ` (drive ${off.driveMinutesPerDay} min a day)` : ""}`;
}

function JobTotals({ job, eq }: { job: PricedJob; eq: PricingEquation }) {
  const al = job.allocations;
  const shares: { label: string; cents: number }[] = [
    { label: `Cost (M + PLC), ${pct(projectCostMargin(eq))}`, cents: Math.round(job.costCents) },
    { label: `Gross profit, ${pct(eq.grossProfit)}`, cents: al.grossProfitCents },
    { label: `Account manager, ${pct(eq.accountManager)}`, cents: al.accountManagerCents },
    { label: `Affiliate, ${pct(eq.affiliate)}`, cents: al.affiliateCents },
    { label: `Evaluator, ${pct(eq.evaluator)}`, cents: al.evaluatorCents },
    ...(eq.reserve > 0 ? [{ label: `Goal reserve, ${pct(eq.reserve)}`, cents: al.reserveCents }] : []),
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="overflow-hidden rounded-xl border border-border">
        <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">The whole job</p>
        <dl className="divide-y divide-border text-sm">
          {[
            ["Crew-hours of work", (job.plh - job.offWork.plh).toFixed(2)],
            [`Travel and time off the work: ${offWorkWhy(job.offWork)}`, job.offWork.plh.toFixed(2)],
            [
              "Days at the job",
              job.offWork.days > 0 ? `${job.offWork.days} (${qty(job.offWork.workHoursPerDay)} hrs of work a day)` : "—",
            ],
            ["Projected crew-hours paid (PLH)", job.plh.toFixed(2)],
            [`Projected labour cost (PLC), at ${money(crewRateCents(eq))}/hr`, money(Math.round(job.plcCents))],
            ["Materials and direct costs (M)", money(job.materialCents)],
            ["Cost (M + PLC)", money(Math.round(job.costCents))],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-3 py-1.5">
              <dt>{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 bg-primary/5 px-3 py-2 font-bold">
            <dt>Price, R = (M + PLC) ÷ {projectCostMargin(eq).toFixed(2)}</dt>
            <dd className="tabular-nums">{money(job.rCents)}</dd>
          </div>
        </dl>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Where the {money(job.rCents)} goes</p>
        <dl className="divide-y divide-border text-sm">
          {shares.map((s) => (
            <div key={s.label} className="flex justify-between gap-3 px-3 py-1.5">
              <dt>{s.label}</dt>
              <dd className="tabular-nums">{money(s.cents)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-xs text-muted-foreground md:col-span-2">
        CR = {eq.leads} lead × {money(eq.leadRateCents)} + {eq.technicians} technician × {money(eq.technicianRateCents)} = {money(crewRateCents(eq))}/hr · RA ={" "}
        {pct(revenueAllocation(eq))} · PCM = {projectCostMargin(eq).toFixed(2)}. Each service has its own production rate (PR). A {qty(eq.workdayHours)}-hour day is {pct(eq.onJobShare)}{" "}
        working at the job; the rest of the day (the drive, loading, the dump, breaks) is paid too, so it is priced in: the larger of that share and the actual drive
        there and back each day.
      </p>
    </div>
  );
}

/** Every photo of one area, large, one at a time. Arrows or swipe through; Escape closes. */
function Gallery({
  title,
  photos,
  thumbs,
  pins,
  start,
  onClose,
}: {
  title: string;
  photos: string[];
  thumbs: string[];
  pins: { x: number; y: number }[][];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(start, Math.max(0, photos.length - 1)));
  const go = (step: number) => setIndex((i) => (i + step + photos.length) % photos.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, photos.length]);
  const [touchX, setTouchX] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Photos of ${title}`} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {title} <span className="text-white/60">· {index + 1} of {photos.length}</span>
        </p>
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          setTouchX(null);
        }}
      >
        {/* Wrapped to the photo's own size, so the pins sit on it at the same fractions. */}
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[index]} alt={`${title}, photo ${index + 1}`} className="block max-h-[calc(100dvh-170px)] max-w-full" />
          <Pins points={pins[index] ?? []} large />
        </div>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className="absolute left-2 rounded-full bg-black/60 p-2 hover:bg-black/80" aria-label="Previous photo">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => go(1)} className="absolute right-2 rounded-full bg-black/60 p-2 hover:bg-black/80" aria-label="Next photo">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 py-3">
          {photos.map((src, i) => (
            <button key={src} type="button" onClick={() => setIndex(i)} className={cn("shrink-0 overflow-hidden rounded-md border-2", i === index ? "border-white" : "border-transparent opacity-60")} aria-label={`Photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbs[i] ?? src} alt="" className="h-14 w-14 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The evaluator's pins on a photo: where the work is, at the fractions they were tapped at. */
function Pins({ points, large = false }: { points: { x: number; y: number }[]; large?: boolean }) {
  return (
    <>
      {points.map((p, i) => (
        <span
          key={i}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          className={cn(
            "pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-red-600 font-bold text-white shadow-md",
            large ? "h-7 w-7 text-xs" : "h-5 w-5 text-[10px]"
          )}
        >
          {i + 1}
        </span>
      ))}
    </>
  );
}

/**
 * What the walkthrough asks for that the lines don't price, above the lines.
 * Each is fixed by adding or changing a line, or ticked off as looked at.
 */
function AreaGaps({
  gaps,
  checked,
  onCheck,
  locked,
}: {
  gaps: { key: string; gap: ScopeGap }[];
  checked: string[];
  onCheck?: (key: string, on: boolean) => void;
  locked: boolean;
}) {
  if (gaps.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-col gap-1.5 rounded-lg border border-amber-400 bg-amber-50/70 p-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {gaps.map(({ key, gap }) => {
        const on = checked.includes(key);
        return (
          <li key={key} className={cn("flex items-start gap-2", on && "opacity-60")}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={on}
              disabled={locked || !onCheck}
              onChange={(e) => onCheck?.(key, e.target.checked)}
              aria-label={`Checked, not needed: ${gap.message}`}
            />
            <span>
              {gap.message}
              <span className="block text-xs opacity-80">Add the service, or tick it if it is covered or not needed.</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
