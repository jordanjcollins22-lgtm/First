"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Images, Plus, X } from "lucide-react";

import {
  crewRateCents,
  priceForward,
  productionService,
  projectCostMargin,
  revenueAllocation,
  servicesByGroup,
  type PriceLine,
  type PricedJob,
  type PricedLine,
  type PricingEquation,
} from "@/lib/forward-pricing";
import type { PriceApproval } from "@/lib/data/price-approvals";
import { PriceSiteMap } from "@/components/proposal/price-site-map";
import { cn } from "@/lib/utils";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
/** The forward-priced job for these lines, with the business's own rates. */
export function priceLines(item: PriceApproval, lines: PriceLine[][]): PricedJob {
  return priceForward(lines, item.pricing.equation, item.pricing.services);
}

/** Areas whose services come to nothing, by name: the price can't be accepted with them. */
export function unpricedAreas(item: PriceApproval, lines: PriceLine[][]): string[] {
  const job = priceLines(item, lines);
  return item.breakdown.areas.filter((_, i) => (job.areas[i]?.rCents ?? 0) <= 0).map((a) => a.name);
}

/**
 * The price, built the forward way and shown all the way through: each area
 * on the left with what it is, what the evaluator wrote and its photos (tap
 * to go through them all), and on the right every service it needs, each at
 * its own production rate: Q, PR, PLH, PLC, M and R. Then the job's totals
 * and where the price goes. Quantities and costs can be changed, services
 * removed and added; the price follows.
 */
export function ForwardBreakdown({ item, lines, onChange, locked = false }: { item: PriceApproval; lines: PriceLine[][]; onChange: (lines: PriceLine[][]) => void; locked?: boolean }) {
  const job = priceLines(item, lines);
  const { equation: eq, services } = item.pricing;
  const [gallery, setGallery] = useState<{ area: number; index: number } | null>(null);
  const forward = item.forward ?? [];

  const setLine = (area: number, index: number, patch: Partial<PriceLine>) =>
    onChange(lines.map((ls, a) => (a === area ? ls.map((l, i) => (i === index ? { ...l, ...patch, note: patch.quantity !== undefined || patch.materialCents !== undefined ? null : l.note } : l)) : ls)));
  const removeLine = (area: number, index: number) => onChange(lines.map((ls, a) => (a === area ? ls.filter((_, i) => i !== index) : ls)));
  const addLine = (area: number, key: string) => {
    const service = productionService(key, services);
    if (!service) return;
    const size = Number(String(item.breakdown.areas[area]?.size ?? "").replace(/[^0-9.]/g, "")) || 0;
    const quantity = service.unit === "SF" ? size : service.unit === "job" ? 1 : 0;
    const materialCents = service.materialCentsPerUnit ? Math.round(quantity * service.materialCentsPerUnit) : 0;
    onChange(lines.map((ls, a) => (a === area ? [...ls, { key, quantity, materialCents, note: quantity === 0 ? "Type how many." : null }] : ls)));
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
            ["Projected crew-hours (PLH)", job.plh.toFixed(2)],
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
        {pct(revenueAllocation(eq))} · PCM = {projectCostMargin(eq).toFixed(2)}. PLH is crew-hours on site; each service has its own production rate (PR).
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
