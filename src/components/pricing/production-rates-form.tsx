"use client";

import { Fragment, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveProductionPricing } from "@/lib/actions/production-pricing-actions";
import {
  PRODUCTION_UNITS,
  crewRateCents,
  pricePerUnitCents,
  projectCostMargin,
  revenueAllocation,
  serviceKey,
  type PricingSetup,
  type ProductionService,
  type ProductionUnit,
} from "@/lib/forward-pricing";
import { cn } from "@/lib/utils";
import { setTimeLogExcluded } from "@/lib/actions/service-timing-actions";
import { averageRate, clockHours, counts, hoursLabel, jobRate, labourHours, roundRate, type ServiceTimeLog } from "@/lib/service-timing";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
const unitWord = (u: ProductionUnit) => (u === "SF" ? "sq ft" : u === "CY" ? "cu yd" : u);

/** A typed number, or 0 for an empty box. */
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

/**
 * The production rates page: who is on a crew and what they are paid, which
 * makes the crew rate, then every service with how much of it one
 * crew-hour gets done and what material it uses. Beside each, what one unit
 * comes to at the price, so a change can be seen before it is saved.
 */
export function ProductionRatesForm({
  initial,
  saved,
  canSave,
  canEdit,
  updatedAt,
  timeLogs = [],
  timingAvailable = false,
}: {
  initial: PricingSetup;
  saved: boolean;
  canSave: boolean;
  canEdit: boolean;
  updatedAt: string | null;
  /** Every service timed on a job, newest first. */
  timeLogs?: ServiceTimeLog[];
  /** False until migration 0337: nothing has been timed because nothing can be. */
  timingAvailable?: boolean;
}) {
  const [eq, setEq] = useState(initial.equation);
  const [services, setServices] = useState<ProductionService[]>(initial.services);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = !canEdit || pending;
  const cr = crewRateCents(eq);
  const crewPeople = eq.leads + eq.technicians;
  const [logs, setLogs] = useState(timeLogs);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const logsFor = (key: string) => logs.filter((l) => l.serviceKey === key);
  const exclude = (id: string, excluded: boolean) => {
    setLogs((list) => list.map((l) => (l.id === id ? { ...l, excluded } : l)));
    start(async () => {
      const result = await setTimeLogExcluded(id, excluded);
      if (!result.ok) {
        setError(result.message);
        setLogs((list) => list.map((l) => (l.id === id ? { ...l, excluded: !excluded } : l)));
      }
    });
  };

  const change = <K extends keyof typeof eq>(key: K, value: (typeof eq)[K]) => {
    setEq((e) => ({ ...e, [key]: value }));
    setDirty(true);
  };
  const changeService = (i: number, patch: Partial<ProductionService>) => {
    setServices((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const addService = () => {
    setServices((list) => [...list, { key: serviceKey("new service", list.map((s) => s.key)), label: "", unit: "SF", pr: null, active: true }]);
    setDirty(true);
  };

  function save() {
    setError(null);
    // A new service takes its key from its name, once it has one.
    const taken: string[] = [];
    const named = services.map((s) => {
      const fresh = s.key.startsWith("new-service") && s.label.trim() !== "";
      const key = fresh ? serviceKey(s.label, [...taken, ...services.map((x) => x.key)]) : s.key;
      taken.push(key);
      return { ...s, key };
    });
    start(async () => {
      const result = await saveProductionPricing({ equation: eq, services: named });
      if (!result.ok) return setError(result.error);
      setServices(named);
      setSavedAt(result.savedAt);
      setDirty(false);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 pb-28">
      <header>
        <h1 className="text-xl font-semibold">Production rates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every price is worked out from these. Each service&apos;s hours are its quantity over its production rate, and the crew&apos;s pay makes those hours a cost. The price is
          that cost and the materials, divided by what is left once the shares are set aside: R = (M + PLC) ÷ PCM.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {saved && savedAt ? `Last saved ${new Date(savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "These are the starting figures. Nothing has been saved yet."}{" "}
          Prices already approved keep what they were approved at.
        </p>
      </header>

      {!canSave && (
        <p className="rounded-xl border border-amber-400 bg-amber-50/70 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          These can&apos;t be saved yet: database update 0336 hasn&apos;t been applied. The figures shown are the ones prices use right now.
        </p>
      )}
      {!canEdit && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">Only an owner or admin can change these.</p>}

      {/* The crew and its pay. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">The crew</h2>
          <p className="text-sm text-muted-foreground">Who is on a crew and what each is paid an hour. Together they make the crew rate, CR.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Project leads", "leads", "leadRateCents"],
              ["Project technicians", "technicians", "technicianRateCents"],
            ] as const
          ).map(([label, countKey, rateKey]) => (
            <div key={countKey} className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  step={1}
                  value={eq[countKey]}
                  disabled={locked}
                  onChange={(e) => change(countKey, Math.max(0, Math.round(num(e.target.value))))}
                  className="h-10 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums"
                />
              </label>
              <span className="pb-2 text-muted-foreground">×</span>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Pay an hour</span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={eq[rateKey] / 100}
                    disabled={locked}
                    onChange={(e) => change(rateKey, Math.max(0, Math.round(num(e.target.value) * 100)))}
                    className="h-10 w-24 rounded-md border border-input bg-background px-2 text-right tabular-nums"
                  />
                </span>
              </label>
              <span className="pb-2 text-sm tabular-nums text-muted-foreground">= {money(eq[countKey] * eq[rateKey])}/hr</span>
            </div>
          ))}
        </div>
        <p className="rounded-lg bg-primary/5 px-3 py-2 text-sm font-semibold">
          Crew rate, CR = {eq.leads} × {money(eq.leadRateCents)} + {eq.technicians} × {money(eq.technicianRateCents)} = <span className="tabular-nums">{money(cr)}/hr</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Shares set aside from every price: gross profit {pct(eq.grossProfit)}, account manager {pct(eq.accountManager)}, affiliate {pct(eq.affiliate)}, evaluator{" "}
          {pct(eq.evaluator)}
          {eq.reserve > 0 ? `, goal reserve ${pct(eq.reserve)}` : ""}. RA = {pct(revenueAllocation(eq))}, so PCM = {projectCostMargin(eq).toFixed(2)}: every dollar of cost is priced at{" "}
          {money(Math.round(100 / projectCostMargin(eq)))}.
        </p>
      </section>

      {/* Every service's production rate. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">
            PR is how much of the service the whole crew gets done in one hour on site. Material is what it uses per unit. Priced at is what one unit comes to for the client,
            with today&apos;s crew rate and shares. Turn a service off to stop it being suggested; a price already saved with it still works.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {timingAvailable
              ? "Every time the crew times a service on a job, it is listed under the service with how much got done and how long it took. The average across all of them is ΣQ ÷ Σ labour-hours, for a crew your size; Use it puts it in PR."
              : "Once database update 0337 is applied, the crew time each service on the job, and every job is listed under its service here with the average across all of them."}
          </p>
        </div>

        {/* Desktop: one row each. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-2 text-left font-medium">Service</th>
                <th className="px-2 py-1.5 text-left font-medium">Unit</th>
                <th className="px-2 py-1.5 text-right font-medium">PR per crew-hour</th>
                <th className="px-2 py-1.5 text-right font-medium">Material per unit</th>
                <th className="px-2 py-1.5 text-left font-medium">Material</th>
                <th className="px-2 py-1.5 text-right font-medium">Priced at</th>
                <th className="py-1.5 pl-2 text-center font-medium">On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((s, i) => (
                <Fragment key={s.key}>
                <tr className={cn(s.active === false && "opacity-50")}>
                  <td className="py-1.5 pr-2">
                    <TextBox value={s.label} placeholder="Name the service" disabled={locked} onChange={(label) => changeService(i, { label })} wide label="Service name" />
                  </td>
                  <td className="px-2 py-1.5">
                    <UnitBox value={s.unit} disabled={locked} onChange={(unit) => changeService(i, { unit, pr: unit === "job" ? null : (s.pr ?? 1) })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RateBox service={s} disabled={locked} onChange={(pr) => changeService(i, { pr })} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <MaterialBox service={s} disabled={locked} onChange={(materialCentsPerUnit) => changeService(i, { materialCentsPerUnit })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextBox value={s.materialName ?? ""} placeholder="—" disabled={locked} onChange={(materialName) => changeService(i, { materialName })} label={`${s.label} material`} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">
                    <PerUnit service={s} eq={eq} />
                  </td>
                  <td className="py-1.5 pl-2 text-center">
                    <input type="checkbox" checked={s.active !== false} disabled={locked} onChange={(e) => changeService(i, { active: e.target.checked })} aria-label={`${s.label || "Service"} on`} className="h-4 w-4" />
                  </td>
                </tr>
                {s.unit !== "job" && (
                  <tr className="border-t-0">
                    <td colSpan={7} className="pb-2 pt-0">
                      <TimedHistory
                        service={s}
                        logs={logsFor(s.key)}
                        crewPeople={crewPeople}
                        open={openHistory === s.key}
                        onToggle={() => setOpenHistory((k) => (k === s.key ? null : s.key))}
                        onUse={canEdit ? (pr) => changeService(i, { pr }) : undefined}
                        onExclude={canEdit ? exclude : undefined}
                        disabled={locked}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phone: one card each. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {services.map((s, i) => (
            <li key={s.key} className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", s.active === false && "opacity-60")}>
              <div className="flex items-center gap-2">
                <TextBox value={s.label} placeholder="Name the service" disabled={locked} onChange={(label) => changeService(i, { label })} wide label="Service name" />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input type="checkbox" checked={s.active !== false} disabled={locked} onChange={(e) => changeService(i, { active: e.target.checked })} className="h-4 w-4" /> On
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <label className="flex flex-col gap-1">
                  Unit
                  <UnitBox value={s.unit} disabled={locked} onChange={(unit) => changeService(i, { unit, pr: unit === "job" ? null : (s.pr ?? 1) })} />
                </label>
                <label className="flex flex-col gap-1">
                  PR per crew-hour
                  <RateBox service={s} disabled={locked} onChange={(pr) => changeService(i, { pr })} />
                </label>
                <label className="flex flex-col gap-1">
                  Material per unit
                  <MaterialBox service={s} disabled={locked} onChange={(materialCentsPerUnit) => changeService(i, { materialCentsPerUnit })} />
                </label>
                <label className="flex flex-col gap-1">
                  Material
                  <TextBox value={s.materialName ?? ""} placeholder="—" disabled={locked} onChange={(materialName) => changeService(i, { materialName })} label={`${s.label} material`} />
                </label>
              </div>
              <p className="text-sm">
                Priced at <span className="font-semibold tabular-nums">
                  <PerUnit service={s} eq={eq} />
                </span>
              </p>
              {s.unit !== "job" && (
                <TimedHistory
                  service={s}
                  logs={logsFor(s.key)}
                  crewPeople={crewPeople}
                  open={openHistory === s.key}
                  onToggle={() => setOpenHistory((k) => (k === s.key ? null : s.key))}
                  onUse={canEdit ? (pr) => changeService(i, { pr }) : undefined}
                  onExclude={canEdit ? exclude : undefined}
                  disabled={locked}
                />
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <button type="button" onClick={addService} disabled={locked} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
            <Plus className="h-4 w-4" /> Add a service
          </button>
        )}
      </section>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : dirty ? (
                <span className="text-muted-foreground">Changes not saved yet.</span>
              ) : saved || savedAt ? (
                <span className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              ) : (
                <span className="text-muted-foreground">Starting figures.</span>
              )}
            </p>
            <Button type="button" className="h-11 px-6 font-semibold" disabled={!dirty || pending || !canSave} onClick={save}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TextBox({ value, placeholder, disabled, onChange, wide, label }: { value: string; placeholder: string; disabled: boolean; onChange: (v: string) => void; wide?: boolean; label: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      maxLength={80}
      className={cn("h-9 rounded-md border border-input bg-background px-2 text-sm", wide ? "w-full min-w-0 md:min-w-[220px]" : "w-full md:w-28")}
    />
  );
}

function UnitBox({ value, disabled, onChange }: { value: ProductionUnit; disabled: boolean; onChange: (u: ProductionUnit) => void }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as ProductionUnit)} aria-label="Unit" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground md:w-auto">
      {PRODUCTION_UNITS.map((u) => (
        <option key={u.unit} value={u.unit}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

function RateBox({ service, disabled, onChange }: { service: ProductionService; disabled: boolean; onChange: (pr: number | null) => void }) {
  if (service.unit === "job") return <span className="text-sm text-muted-foreground">No crew time</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={service.pr ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim() === "" ? null : Math.max(0, num(e.target.value)))}
        aria-label={`${service.label} production rate`}
        className={cn("h-9 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums", !service.pr ? "border-amber-500" : "border-input")}
      />
      <span className="text-xs text-muted-foreground">{unitWord(service.unit)}</span>
    </span>
  );
}

function MaterialBox({ service, disabled, onChange }: { service: ProductionService; disabled: boolean; onChange: (cents: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={service.materialCentsPerUnit ? service.materialCentsPerUnit / 100 : ""}
        placeholder="0"
        disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.round(num(e.target.value) * 100)))}
        aria-label={`${service.label} material per unit`}
        className="h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
      />
    </span>
  );
}

/** What one unit of the service is priced at: "$0.36 / sq ft". */
function PerUnit({ service, eq }: { service: ProductionService; eq: PricingSetup["equation"] }) {
  if (service.unit !== "job" && !service.pr) return <span className="font-normal text-amber-700">Needs a rate</span>;
  const cents = pricePerUnitCents(service, eq);
  if (cents == null) return <>—</>;
  return (
    <>
      {money(Math.round(cents))}
      <span className="font-normal text-muted-foreground"> / {service.unit === "job" ? "job" : unitWord(service.unit)}</span>
    </>
  );
}

const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Under a service: every job it was timed on, and the average across them,
 * worked out for a crew this size, with a button to use it as the rate.
 */
function TimedHistory({
  service,
  logs,
  crewPeople,
  open,
  onToggle,
  onUse,
  onExclude,
  disabled,
}: {
  service: ProductionService;
  logs: ServiceTimeLog[];
  crewPeople: number;
  open: boolean;
  onToggle: () => void;
  onUse?: (pr: number) => void;
  onExclude?: (id: string, excluded: boolean) => void;
  disabled: boolean;
}) {
  if (logs.length === 0) return <p className="text-xs text-muted-foreground">Not timed on a job yet.</p>;
  const avg = averageRate(logs, crewPeople);
  const unit = unitWord(service.unit);
  const suggested = avg ? roundRate(avg.perCrewHour) : null;
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={onToggle} className="font-medium text-primary underline-offset-2 hover:underline" aria-expanded={open}>
          Timed on {new Set(logs.map((l) => l.jobId)).size} job{new Set(logs.map((l) => l.jobId)).size === 1 ? "" : "s"} ({logs.length} time{logs.length === 1 ? "" : "s"}) {open ? "▴" : "▾"}
        </button>
        {avg ? (
          <span className="tabular-nums">
            Average <span className="font-semibold">{amount(roundRate(avg.perCrewHour))} {unit}/crew-hr</span>
            <span className="text-muted-foreground">
              {" "}
              ({amount(avg.quantity)} {unit} in {amount(Math.round(avg.labourHours * 10) / 10)} labour-hrs = {amount(Math.round(avg.perLabourHour * 10) / 10)} per person-hour, × {crewPeople})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Nothing counted toward an average.</span>
        )}
        {onUse && suggested != null && suggested !== service.pr && (
          <button type="button" disabled={disabled} onClick={() => onUse(suggested)} className="rounded-md border border-primary px-2 py-0.5 font-medium text-primary hover:bg-primary/10">
            Use {amount(suggested)}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 text-left font-medium">Job</th>
                <th className="px-2 py-1 text-left font-medium">Area</th>
                <th className="px-2 py-1 text-left font-medium">Day</th>
                <th className="px-2 py-1 text-right font-medium">Q</th>
                <th className="px-2 py-1 text-right font-medium">Took</th>
                <th className="px-2 py-1 text-right font-medium">People</th>
                <th className="px-2 py-1 text-right font-medium">Labour-hrs</th>
                <th className="px-2 py-1 text-right font-medium">Rate /crew-hr</th>
                {onExclude && <th className="py-1 pl-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => {
                const rate = jobRate(l, crewPeople);
                return (
                  <tr key={l.id} className={cn(!counts(l) && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                    <td className="py-1 pr-2">
                      <a href={`/jobs/${l.jobId}`} className="text-primary hover:underline">
                        {l.jobNumber != null ? `#${l.jobNumber}` : "Job"}
                      </a>
                      {l.where ? <span className="text-muted-foreground"> · {l.where}</span> : null}
                    </td>
                    <td className="px-2 py-1">{l.zoneName}</td>
                    <td className="whitespace-nowrap px-2 py-1">{new Date(l.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {amount(l.quantity ?? 0)} {unitWord(l.unit)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{hoursLabel(clockHours(l) ?? 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.people ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{amount(Math.round((labourHours(l) ?? 0) * 100) / 100)}</td>
                    <td className="px-2 py-1 text-right font-medium tabular-nums">{rate != null ? amount(roundRate(rate)) : "—"}</td>
                    {onExclude && (
                      <td className="py-1 pl-2 text-right">
                        <button type="button" disabled={disabled} onClick={() => onExclude(l.id, !l.excluded)} className="text-primary no-underline hover:underline">
                          {l.excluded ? "Put back" : "Leave out"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
