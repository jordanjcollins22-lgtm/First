"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PricingReportView } from "@/components/pricing/pricing-report";
import { PrintButton } from "@/components/receipt/print-button";
import { savePricingEstimate, suggestAreaFromPhotos } from "@/lib/actions/pricing-estimate-actions";
import type { PriceSources } from "@/lib/pricing-materials";
import { deriveQuantity, priceProject, type AppFigures, type AreaInput, type ProjectInput } from "@/lib/pricing-report";
import { CONDITIONS, rateByKey, rateCategories, type PricingVariables } from "@/lib/pricing-variables";

/**
 * The office's side of a job's pricing report. Each area: its measurements,
 * the tasks from the 97 with their quantities (worked out from the
 * measurements where that is obvious), and its conditions. Claude reads the
 * area's photos and suggests conditions and counted tasks; nothing it says
 * is priced until somebody presses "Use" and confirms the area.
 *
 * The report re-prices as anything changes, with the same pure arithmetic
 * the server uses, and prints on its own.
 */
export function PricingEstimateEditor(props: {
  jobId: string;
  initial: ProjectInput;
  saved: boolean;
  canSave: boolean;
  variables: PricingVariables;
  sources: PriceSources;
  app: AppFigures;
  photoUrls: Record<string, string>;
  driveFromMap: number | null;
}) {
  const [input, setInput] = useState<ProjectInput>(props.initial);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>(props.saved ? "Saved" : props.canSave ? "Not saved yet" : "Saving needs database update 0371");
  const [pending, start] = useTransition();
  const [reading, setReading] = useState<string | null>(null);

  const report = useMemo(() => priceProject(input, props.variables, props.sources, props.app), [input, props.variables, props.sources, props.app]);
  const rates = useMemo(() => rateByKey(props.variables), [props.variables]);
  const categories = useMemo(() => rateCategories(props.variables.rates), [props.variables.rates]);

  const update = (fn: (cur: ProjectInput) => ProjectInput) => {
    setInput(fn);
    setDirty(true);
  };
  const updateArea = (id: string, fn: (a: AreaInput) => AreaInput) => update((cur) => ({ ...cur, areas: cur.areas.map((a) => (a.id === id ? fn(a) : a)) }));

  const save = () =>
    start(async () => {
      const res = await savePricingEstimate(props.jobId, input);
      if (res.ok) {
        setDirty(false);
        setStatus("Saved");
      } else setStatus(res.error);
    });

  const read = (area: AreaInput) => {
    setReading(area.id);
    start(async () => {
      const res = await suggestAreaFromPhotos({ jobId: props.jobId, area: { name: area.name, photos: area.photos ?? [], wants: area.wants, taskKeys: area.tasks.map((t) => t.key) } });
      setReading(null);
      if (res.ok) updateArea(area.id, (a) => ({ ...a, suggested: res.suggestion }));
      else setStatus(res.error);
    });
  };

  const acceptSuggestion = (area: AreaInput) =>
    updateArea(area.id, (a) => {
      const s = a.suggested;
      if (!s) return a;
      const have = new Set(a.tasks.map((t) => t.key));
      return {
        ...a,
        conditions: { ...a.conditions, ...s.conditions },
        tasks: [...a.tasks.map((t) => ({ ...t, qty: s.tasks.find((x) => x.key === t.key)?.qty ?? t.qty })), ...s.tasks.filter((t) => !have.has(t.key)).map((t) => ({ key: t.key, qty: t.qty }))],
      };
    });

  const addArea = () =>
    update((cur) => ({
      ...cur,
      areas: [...cur.areas, { id: `area-${Date.now()}`, name: `Area ${cur.areas.length + 1}`, sf: null, lf: null, depthIn: null, tasks: [], conditions: {}, confirmed: false, photos: [] }],
    }));

  const dollars = (cents: number | undefined) => ((cents ?? 0) / 100).toString();

  return (
    <div className="mx-auto max-w-6xl px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/jobs/${props.jobId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to the job
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : status}</span>
          <Button disabled={pending || !dirty || !props.canSave} onClick={save}>
            Save
          </Button>
          <PrintButton />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,8.5in)]">
        <div className="space-y-3 print:hidden">
          <div className="rounded-lg border bg-card p-3 text-sm">
            <h2 className="mb-2 font-bold">Job</h2>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Leads" value={input.crew?.leads ?? props.variables.crew.leads} onChange={(n) => update((c) => ({ ...c, crew: { leads: Math.round(n ?? 0), techs: c.crew?.techs ?? props.variables.crew.techs } }))} />
              <Field label="Techs" value={input.crew?.techs ?? props.variables.crew.techs} onChange={(n) => update((c) => ({ ...c, crew: { leads: c.crew?.leads ?? props.variables.crew.leads, techs: Math.round(n ?? 0) } }))} />
              <Field
                label={`Drive each way, min${props.driveFromMap != null ? ` (map: ${props.driveFromMap})` : ""}`}
                value={input.driveMinutesEachWay ?? null}
                onChange={(n) => update((c) => ({ ...c, driveMinutesEachWay: n }))}
              />
              <Field label="Dump runs" value={input.disposalTrips ?? 0} onChange={(n) => update((c) => ({ ...c, disposalTrips: Math.round(n ?? 0) }))} />
              {(
                [
                  ["delivery", "Delivery $"],
                  ["subcontractors", "Subcontractors $"],
                  ["rentals", "Rentals $"],
                  ["permits", "Permits / inspections $"],
                  ["other", "Other direct $"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} value={Number(dollars(input.direct?.[key]))} onChange={(n) => update((c) => ({ ...c, direct: { ...c.direct, [key]: Math.round((n ?? 0) * 100) } }))} />
              ))}
            </div>
          </div>

          {input.areas.map((area) => (
            <div key={area.id} className="rounded-lg border bg-card p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <input className="h-9 flex-1 rounded-md border px-2 font-bold" value={area.name} onChange={(e) => updateArea(area.id, (a) => ({ ...a, name: e.target.value }))} />
                <button type="button" aria-label="Remove area" className="text-muted-foreground hover:text-destructive" onClick={() => update((c) => ({ ...c, areas: c.areas.filter((a) => a.id !== area.id) }))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {area.wants && <p className="mb-2 text-xs text-muted-foreground">Client: {area.wants}</p>}
              <div className="grid grid-cols-3 gap-2">
                <Field label="SF" value={area.sf ?? null} onChange={(n) => updateArea(area.id, (a) => ({ ...a, sf: n }))} />
                <Field label="LF (edge)" value={area.lf ?? null} onChange={(n) => updateArea(area.id, (a) => ({ ...a, lf: n }))} />
                <Field label="Depth, in" value={area.depthIn ?? null} onChange={(n) => updateArea(area.id, (a) => ({ ...a, depthIn: n }))} />
              </div>

              {(area.photos?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 overflow-x-auto">
                    {area.photos!.map((p) =>
                      props.photoUrls[p] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p} src={props.photoUrls[p]} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                      ) : null
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="mt-1" disabled={pending} onClick={() => read(area)}>
                    <Sparkles className="mr-1 h-4 w-4" />
                    {reading === area.id ? "Reading the photos…" : "Suggest from photos"}
                  </Button>
                </div>
              )}

              {area.suggested && (
                <div className="mt-2 rounded-md border border-teal-300 bg-teal-50 p-2 text-xs dark:bg-teal-950/30">
                  <p className="font-semibold">Claude suggests</p>
                  <p>
                    {CONDITIONS.filter((c) => area.suggested!.conditions[c.key]).map((c) => `${c.label}: ${c.options.find((o) => o.value === area.suggested!.conditions[c.key])?.label}`).join(" · ") || "No conditions it could tell."}
                  </p>
                  <ul className="mt-1 list-disc pl-4">
                    {area.suggested.tasks.map((t) => (
                      <li key={t.key}>
                        {rates.get(t.key)?.task ?? t.key}
                        {t.qty != null ? ` × ${t.qty}` : ""} <span className="text-muted-foreground">({t.why})</span>
                      </li>
                    ))}
                  </ul>
                  {area.suggested.notes && <p className="mt-1 text-muted-foreground">{area.suggested.notes}</p>}
                  <div className="mt-1 flex gap-2">
                    <Button size="sm" onClick={() => acceptSuggestion(area)}>
                      Use
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateArea(area.id, (a) => ({ ...a, suggested: null }))}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2">
                {CONDITIONS.map((c) => (
                  <label key={c.key} className="block">
                    <span className="text-xs text-muted-foreground">{c.label}</span>
                    <select
                      className="h-9 w-full rounded-md border bg-card px-1"
                      value={area.conditions[c.key] ?? c.defaultOption}
                      onChange={(e) => updateArea(area.id, (a) => ({ ...a, conditions: { ...a.conditions, [c.key]: e.target.value } }))}
                    >
                      {c.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label} ×{props.variables.conditions[c.key][o.value]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 font-medium">
                <input type="checkbox" checked={Boolean(area.confirmed)} onChange={(e) => updateArea(area.id, (a) => ({ ...a, confirmed: e.target.checked }))} />
                Conditions confirmed
              </label>

              <table className="mt-2 w-full">
                <tbody>
                  {area.tasks.map((t, i) => {
                    const rate = rates.get(t.key);
                    const derived = rate ? deriveQuantity(rate, { key: t.key }, area) : null;
                    return (
                      <tr key={`${t.key}-${i}`} className="border-t">
                        <td className="py-1 pr-1">{rate?.task ?? t.key}</td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            step="any"
                            className="h-8 w-20 rounded-md border px-1 tabular-nums"
                            placeholder={derived ? String(derived.qty) : "qty"}
                            value={t.qty ?? ""}
                            onChange={(e) => {
                              const n = e.target.value.trim() === "" ? null : Number(e.target.value);
                              updateArea(area.id, (a) => ({ ...a, tasks: a.tasks.map((x, j) => (j === i ? { ...x, qty: n != null && Number.isFinite(n) ? n : null } : x)) }));
                            }}
                          />{" "}
                          <span className="text-xs text-muted-foreground">{rate?.unit}</span>
                        </td>
                        <td className="py-1 text-right">
                          <button type="button" aria-label="Remove task" className="text-muted-foreground hover:text-destructive" onClick={() => updateArea(area.id, (a) => ({ ...a, tasks: a.tasks.filter((_, j) => j !== i) }))}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-card px-1"
                value=""
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) updateArea(area.id, (a) => ({ ...a, tasks: [...a.tasks, { key, qty: null }] }));
                }}
              >
                <option value="">Add a task…</option>
                {categories.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {props.variables.rates
                      .filter((r) => r.category === cat)
                      .map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.task} ({r.unit})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
          <Button variant="outline" onClick={addArea}>
            Add an area
          </Button>
        </div>

        <div className="print-root rounded-lg border print:rounded-none print:border-0">
          <PricingReportView report={report} variables={props.variables} date={new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
        </div>
      </div>
      <style>{`@media print {
        @page { size: letter portrait; margin: 0.4in; }
        .print-root { left: 0; right: 0; width: auto !important; }
      }`}</style>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        step="any"
        className="h-9 w-full rounded-md border px-2 tabular-nums"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = raw === "" ? null : Number(raw);
          if (n === null || Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
