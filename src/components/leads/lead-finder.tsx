"use client";

/* eslint-disable @next/next/no-img-element -- a Mapbox static picture, not optimisable */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  CATEGORY_LABEL,
  GROUP_CAP,
  GROUP_LABEL,
  LEAD_FINDER_LEAD_SCORE,
  LEAD_FINDER_LETTER_SCORE,
  RUBRIC,
  SERVICE_LABEL,
  TIER_LABEL,
  contactSearchUrl,
  formatAcres,
  fullAddress,
  satelliteLink,
  satelliteZoom,
  scoreProspect,
  streetViewUrl,
  suggestedServices,
  type RubricChecks,
  type RubricGroup,
} from "@/lib/lead-finder";
import { MAP_CREDIT, satelliteUrl } from "@/lib/lot-map";
import type { FinderRow } from "@/lib/lead-finder-view";
import {
  fillLeadFinderWeek,
  importLeadFinderSeeds,
  makeLeadFromFinder,
  pullLeadFinderParcels,
  saveLeadFinderReview,
  skipLeadFinderParcel,
} from "@/lib/actions/lead-finder-actions";

export interface LeadFinderProps {
  week: string;
  rows: FinderRow[];
  counts: { total: number; waiting: number; reviewed: number; leads: number; skipped: number };
  /** False on the review page, or before the migration: the boxes still tick, nothing is saved. */
  canSave: boolean;
  /** Why nothing saves, shown at the top when canSave is false. */
  readOnlyNote?: string;
  mapboxToken: string;
}

const STATUS_LABEL: Record<FinderRow["status"], string> = { new: "To look at", reviewed: "Scored", lead: "Lead", skipped: "Skipped" };

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function weekLabel(week: string): string {
  const d = new Date(`${week}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function scoreTone(score: number | null): string {
  if (score == null) return "bg-stone-100 text-stone-500";
  if (score >= LEAD_FINDER_LEAD_SCORE) return "bg-emerald-100 text-emerald-800";
  if (score >= LEAD_FINDER_LETTER_SCORE) return "bg-amber-100 text-amber-800";
  return "bg-stone-200 text-stone-700";
}

export function LeadFinder({ week, rows, counts, canSave, readOnlyNote, mapboxToken }: LeadFinderProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  // Ticks the office has made on this visit, by property, so moving between
  // cards does not lose them before they are saved.
  const [draft, setDraft] = useState<Record<string, RubricChecks>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const checksOf = (r: FinderRow) => draft[r.id] ?? r.checks;
  const liveScore = (r: FinderRow) => scoreProspect(checksOf(r), { category: r.category, acreage: r.acreage, ownerState: r.ownerState, name: `${r.name} ${r.typeLabel ?? ""}` });
  const touched = (r: FinderRow) => draft[r.id] != null || notes[r.id] != null;

  const scored = rows.filter((r) => r.score != null || draft[r.id] != null).length;

  function run<T>(work: () => Promise<{ ok: true; value: T; message?: string } | { ok: false; error: string }>, after?: (value: T) => void) {
    if (!canSave) {
      setMessage({ tone: "error", text: readOnlyNote ?? "Nothing is saved here." });
      return;
    }
    startTransition(async () => {
      const res = await work();
      if (res.ok) {
        setMessage(res.message ? { tone: "ok", text: res.message } : null);
        after?.(res.value);
        router.refresh();
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <section id="lf-week" className="rounded-xl border border-stone-200 bg-white/70 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Week of {weekLabel(week)}</h2>
            <p className="text-sm text-stone-600">
              {rows.length} to look at this week · {scored} scored · {rows.filter((r) => r.status === "lead").length} made leads.{" "}
              {counts.total} properties in all, {counts.waiting} not looked at yet.
            </p>
          </div>
          {canSave && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => pullLeadFinderParcels())}>
                Pull the State roll
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => importLeadFinderSeeds())}>
                Load the business list
              </Button>
              <Button size="sm" disabled={pending} onClick={() => run(() => fillLeadFinderWeek())}>
                Fill this week&apos;s list
              </Button>
            </div>
          )}
        </div>
        {!canSave && readOnlyNote && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{readOnlyNote}</p>}
        {message && (
          <p className={`mt-2 rounded-md px-3 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>{message.text}</p>
        )}
      </section>

      {rows.length === 0 ? (
        <p id="lf-list" className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          Nothing on this week&apos;s list yet. Pull the State roll or load the business list, then fill the week.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ol id="lf-list" className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white/70">
            {rows.map((r, i) => {
              const live = touched(r) ? liveScore(r).score : r.score;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-stone-50 ${selected?.id === r.id ? "bg-emerald-50/70" : ""}`}
                  >
                    <span className="w-5 shrink-0 pt-0.5 text-xs text-stone-400">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {CATEGORY_LABEL[r.category]}
                        {r.typeLabel && r.typeLabel !== CATEGORY_LABEL[r.category] ? ` · ${r.typeLabel}` : ""} · {r.address || "No street address"}
                        {r.city ? `, ${r.city}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreTone(live)}`}>{live == null ? "–" : `${live}/10`}</span>
                      <span className="text-[10px] uppercase tracking-wide text-stone-400">{r.seedPriority ? `List ${r.seedPriority} · ` : ""}{STATUS_LABEL[r.status]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {selected && (
            <Detail
              key={selected.id}
              row={selected}
              checks={checksOf(selected)}
              note={notes[selected.id] ?? selected.note ?? ""}
              mapboxToken={mapboxToken}
              canSave={canSave}
              pending={pending}
              onChecks={(c) => setDraft((d) => ({ ...d, [selected.id]: c }))}
              onNote={(n) => setNotes((d) => ({ ...d, [selected.id]: n }))}
              onSave={() =>
                run(
                  () => saveLeadFinderReview(selected.id, checksOf(selected), notes[selected.id] ?? selected.note ?? null),
                  () => {
                    setDraft((d) => without(d, selected.id));
                    setNotes((d) => without(d, selected.id));
                    const next = rows.find((r, i) => i > rows.indexOf(selected) && r.status === "new");
                    if (next) setSelectedId(next.id);
                  }
                )
              }
              onLead={(force) => run(() => makeLeadFromFinder(selected.id, force))}
              onSkip={() => run(() => skipLeadFinderParcel(selected.id))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Detail({
  row,
  checks,
  note,
  mapboxToken,
  canSave,
  pending,
  onChecks,
  onNote,
  onSave,
  onLead,
  onSkip,
}: {
  row: FinderRow;
  checks: RubricChecks;
  note: string;
  mapboxToken: string;
  canSave: boolean;
  pending: boolean;
  onChecks: (c: RubricChecks) => void;
  onNote: (n: string) => void;
  onSave: () => void;
  onLead: (force: boolean) => void;
  onSkip: () => void;
}) {
  const result = useMemo(
    () => scoreProspect(checks, { category: row.category, acreage: row.acreage, ownerState: row.ownerState, name: `${row.name} ${row.typeLabel ?? ""}` }),
    [checks, row]
  );
  const services = suggestedServices(checks, row.category, row.acreage);
  const anyTicked = Object.values(checks).some(Boolean);
  const picture =
    mapboxToken && row.lat != null && row.lng != null
      ? satelliteUrl({ center: [row.lng, row.lat], zoom: satelliteZoom(row.acreage), bearing: 0, width: 600, height: 360 }, mapboxToken)
      : null;
  const savedScore = row.score;

  return (
    <article className="space-y-4 rounded-xl border border-stone-200 bg-white/80 p-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
          {CATEGORY_LABEL[row.category]}
          {row.typeLabel ? ` · ${row.typeLabel}` : ""}
          {row.source === "seed" ? " · business list" : row.source === "sdat" ? " · State roll" : ""}
        </p>
        <h3 className="text-xl font-bold leading-snug">{row.name}</h3>
        <p className="text-sm text-stone-600">{fullAddress(row)}</p>
      </header>

      <div id="lf-map" className="overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
        {picture ? (
          <figure>
            <img src={picture} alt={`Satellite view of ${row.name}`} className="aspect-[5/3] w-full object-cover" />
            <figcaption className="px-2 py-1 text-[10px] text-stone-500">{MAP_CREDIT}</figcaption>
          </figure>
        ) : (
          <div className="flex aspect-[5/3] items-center justify-center p-4 text-center text-sm text-stone-500">
            {row.lat == null ? "No point on the map yet (the State roll's pull adds one). Open satellite and Street View below." : "Satellite picture needs the Mapbox token."}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <a className="rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white" href={streetViewUrl(row)} target="_blank" rel="noopener noreferrer">
          Street View
        </a>
        <a className="rounded-md border border-stone-300 px-3 py-1.5 font-medium" href={satelliteLink(row)} target="_blank" rel="noopener noreferrer">
          Satellite (Google)
        </a>
        <a className="rounded-md border border-stone-300 px-3 py-1.5 font-medium" href={contactSearchUrl(row)} target="_blank" rel="noopener noreferrer">
          Find contact
        </a>
        {row.website && (
          <a className="rounded-md border border-stone-300 px-3 py-1.5 font-medium" href={row.website} target="_blank" rel="noopener noreferrer">
            Website
          </a>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {row.acreage != null && <Fact label="Lot" value={formatAcres(row.acreage)} />}
        {row.assessedValue != null && <Fact label="Assessed" value={money(row.assessedValue)} />}
        {row.phone && <Fact label="Phone (public)" value={row.phone} />}
        {row.ownerName && <Fact label="Owner" value={row.ownerName} />}
        {row.ownerMailing && <Fact label="Tax bill goes to" value={row.ownerMailing} />}
        {row.reason && <Fact label="Why it's on the list" value={row.reason} wide />}
      </dl>

      <section id="lf-score" className="rounded-lg border border-stone-200 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="font-semibold">Landscaping need</h4>
          <p className="text-right">
            <span className={`rounded-full px-2.5 py-1 text-lg font-bold ${scoreTone(result.score)}`}>{result.score}/10</span>
          </p>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {TIER_LABEL[result.tier]}
          {savedScore != null && savedScore !== result.score ? ` (saved: ${savedScore}/10)` : ""}
        </p>

        {(["satellite", "streetView", "reviews"] as RubricGroup[]).map((group) => (
          <fieldset key={group} className="mt-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {GROUP_LABEL[group]} · {result.byGroup[group]}/{GROUP_CAP[group]}
            </legend>
            <div className="mt-1 space-y-1">
              {RUBRIC.filter((c) => c.group === group).map((c) => (
                <label key={c.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    data-check={c.key}
                    checked={Boolean(checks[c.key])}
                    onChange={(e) => onChecks({ ...checks, [c.key]: e.target.checked })}
                  />
                  <span>
                    {c.label}
                    {c.points > 1 ? ` (+${c.points})` : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {GROUP_LABEL.property} · {result.byGroup.property}/{GROUP_CAP.property}
          </p>
          <p className="text-sm text-stone-600">{result.propertyReasons.length ? result.propertyReasons.join("; ") : "Nothing the roll says adds points."}</p>
        </div>

        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{anyTicked ? "Suggested services (from what you saw)" : "Likely services (by type, before looking)"}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span key={s} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">
                {SERVICE_LABEL[s]}
              </span>
            ))}
          </div>
        </div>

        <label className="mt-3 block text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">One line on what you saw</span>
          <textarea
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
            rows={2}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Lot faded and cracked, grey mulch out front, staining by the dumpster."
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || !canSave} onClick={onSave}>
            Save score
          </Button>
          {row.status === "lead" ? (
            <span className="self-center text-sm font-medium text-emerald-800">On the Leads page as a prospect.</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !canSave || savedScore == null}
              title={savedScore == null ? "Save the score first" : undefined}
              onClick={() => onLead(savedScore != null && savedScore < LEAD_FINDER_LEAD_SCORE)}
            >
              {savedScore != null && savedScore < LEAD_FINDER_LEAD_SCORE ? "Make a lead anyway" : "Make a lead"}
            </Button>
          )}
          {row.status !== "skipped" && row.status !== "lead" && (
            <Button size="sm" variant="ghost" disabled={pending || !canSave} onClick={onSkip}>
              Skip
            </Button>
          )}
        </div>
      </section>
    </article>
  );
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3" : undefined}>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
