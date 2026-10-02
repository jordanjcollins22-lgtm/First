"use client";

import { useState, useTransition } from "react";
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
}: {
  initial: PricingSetup;
  saved: boolean;
  canSave: boolean;
  canEdit: boolean;
  updatedAt: string | null;
}) {
  const [eq, setEq] = useState(initial.equation);
  const [services, setServices] = useState<ProductionService[]>(initial.services);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = !canEdit || pending;
  const cr = crewRateCents(eq);

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
                <tr key={s.key} className={cn(s.active === false && "opacity-50")}>
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
