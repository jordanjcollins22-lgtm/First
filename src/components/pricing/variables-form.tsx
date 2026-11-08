"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { saveBusinessVariables } from "@/lib/actions/business-variables-actions";
import { saveBackOfficeSetting } from "@/lib/actions/back-office-actions";
import type { PricedMaterial } from "@/lib/pricing-materials";
import type { AppFigures } from "@/lib/pricing-report";
import {
  CONDITIONS,
  DEFAULT_VARIABLES,
  bandLabel,
  impliedMargin,
  rateCategories,
  type CapacityBand,
  type ConditionKey,
  type InputSource,
  type PricingVariables,
} from "@/lib/pricing-variables";
import type { RegisteredVariable } from "@/lib/variables-registry";

export interface CommissionDefaults {
  ready: boolean;
  defaultAccountManagerPct: number;
  defaultEvaluatorPct: number;
  defaultAffiliatePct: number;
  holdbackCollectPct: number;
  holdbackMarginPct: number;
  holdbackCrewCostPerHour: number;
}

type CommissionKey = Exclude<keyof CommissionDefaults, "ready">;

/**
 * Admin › Variables: every number the business touches, on one page. The
 * pricing report's variables are edited here and saved together; the
 * commission defaults save straight to the back office settings they already
 * live in; everything else is listed with where it lives.
 */
export function VariablesForm(props: {
  initial: PricingVariables;
  saved: boolean;
  canSave: boolean;
  canEdit: boolean;
  updatedAt: string | null;
  app: AppFigures;
  commissions: CommissionDefaults;
  canEditCommissions: boolean;
  materials: PricedMaterial[];
  others: RegisteredVariable[];
}) {
  const [v, setV] = useState<PricingVariables>(props.initial);
  const [status, setStatus] = useState<string | null>(props.saved ? `Saved${props.updatedAt ? ` ${new Date(props.updatedAt).toLocaleString("en-US")}` : ""}` : "Starting figures: nothing saved yet");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const editable = props.canEdit && props.canSave;

  const set = (fn: (cur: PricingVariables) => PricingVariables) => {
    setV(fn);
    setDirty(true);
  };

  const save = () =>
    start(async () => {
      const res = await saveBusinessVariables(v);
      if (res.ok) {
        setDirty(false);
        setStatus(`Saved ${new Date(res.savedAt).toLocaleString("en-US")}`);
      } else setStatus(res.error);
    });

  const categories = useMemo(() => rateCategories(v.rates), [v.rates]);
  const shownRates = v.rates.filter((r) => !filter.trim() || `${r.category} ${r.task}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 pb-28 text-sm">
      <header>
        <h1 className="text-2xl font-bold">Variables</h1>
        <p className="text-muted-foreground">{status}</p>
        {!props.canSave && <p className="mt-1 font-medium text-amber-700">Saving needs database update 0371. Until then the starting figures below are what every price uses.</p>}
        {!props.canEdit && <p className="mt-1 text-muted-foreground">Only an owner or admin can change these.</p>}
        <nav className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-primary">
          {[
            ["var-pay", "Crew pay"],
            ["var-commissions", "Commissions"],
            ["var-capacity", "Capacity multipliers"],
            ["var-indirect", "Indirect pool"],
            ["var-crew", "Crew"],
            ["var-travel", "Travel"],
            ["var-logistics", "Logistics"],
            ["var-conditions", "Conditions"],
            ["var-rates", "Production rates"],
            ["var-materials", "Material prices"],
            ["var-other", "Everything else"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="underline underline-offset-2">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="var-pay" title="Crew pay (pay for performance)">
        <Grid>
          <Num label="P4P share of labour revenue (P − DĈ)" suffix="%" value={v.pay.p4pShare * 100} step={0.5} disabled={!editable} onChange={(n) => set((c) => ({ ...c, pay: { ...c.pay, p4pShare: n / 100 } }))} />
          <Num label="Lead's weight against a tech's 1" suffix="×" value={v.pay.leadWeight} step={0.05} disabled={!editable} onChange={(n) => set((c) => ({ ...c, pay: { ...c.pay, leadWeight: n } }))} hint="1.5 matches today's $45 / $30" />
          <Num label="Minimum wage (Maryland, assumed)" prefix="$" suffix="/h" value={v.pay.minWageCents / 100} step={0.05} disabled={!editable} onChange={(n) => set((c) => ({ ...c, pay: { ...c.pay, minWageCents: Math.round(n * 100) } }))} hint="Floor: min wage × hours worked" />
        </Grid>
      </Section>

      <Section id="var-commissions" title="Commissions">
        {!props.commissions.ready && <p className="mb-2 text-amber-700">The back office settings table isn&apos;t there yet (update 0364): these are the defaults.</p>}
        <Grid>
          {(
            [
              ["defaultAccountManagerPct", "Account manager default", "%"],
              ["defaultEvaluatorPct", "Evaluator default", "%"],
              ["defaultAffiliatePct", "Affiliate (marketing) default", "%"],
              ["holdbackCollectPct", "Hold-back: paid on collection", "%"],
              ["holdbackMarginPct", "Hold-back: margin to release the rest", "%"],
              ["holdbackCrewCostPerHour", "Hold-back margin test: crew cost", "$/h"],
            ] as [CommissionKey, string, string][]
          ).map(([key, label, unit]) => (
            <CommissionField key={key} k={key} label={label} unit={unit} initial={props.commissions[key]} disabled={!props.canEditCommissions || !props.commissions.ready} />
          ))}
        </Grid>
        <p className="mt-2 text-xs text-muted-foreground">Saved to the back office settings as soon as you leave the box. Per-person rates stay on Money › Commissions.</p>
      </Section>

      <Section id="var-capacity" title="Capacity multipliers μ(U)">
        <table className="w-full max-w-md">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Booked capacity U</th>
              <th className="py-1 font-medium">Up to</th>
              <th className="py-1 font-medium">μ</th>
              <th className="py-1 font-medium">Implied margin</th>
            </tr>
          </thead>
          <tbody>
            {v.bands.map((b, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{bandLabel(v.bands, i)}</td>
                <td className="py-1">
                  {b.below == null ? (
                    "and over"
                  ) : (
                    <SmallNum value={b.below * 100} suffix="%" disabled={!editable} onChange={(n) => set((c) => ({ ...c, bands: c.bands.map((x, j): CapacityBand => (j === i ? { ...x, below: n / 100 } : x)) }))} />
                  )}
                </td>
                <td className="py-1">
                  <SmallNum value={b.multiplier} suffix="×" step={0.05} disabled={!editable} onChange={(n) => set((c) => ({ ...c, bands: c.bands.map((x, j): CapacityBand => (j === i ? { ...x, multiplier: n } : x)) }))} />
                </td>
                <td className="py-1 tabular-nums">{(impliedMargin(b.multiplier) * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 font-semibold">U = booked hours ÷ available hours</h3>
        <SourcePick value={v.capacity.source} disabled={!editable} onChange={(s) => set((c) => ({ ...c, capacity: { ...c.capacity, source: s } }))} />
        <Grid>
          <Num label="Crews" value={v.capacity.crews} disabled={!editable} onChange={(n) => set((c) => ({ ...c, capacity: { ...c.capacity, crews: n } }))} />
          <Num label="Workdays a week" value={v.capacity.workdaysPerWeek} disabled={!editable} onChange={(n) => set((c) => ({ ...c, capacity: { ...c.capacity, workdaysPerWeek: n } }))} />
          <Num label="Weeks ahead counted" value={v.capacity.windowWeeks} disabled={!editable} onChange={(n) => set((c) => ({ ...c, capacity: { ...c.capacity, windowWeeks: n } }))} />
          <Num label="Booked hours, entered by hand" value={v.capacity.bookedHours} disabled={!editable} onChange={(n) => set((c) => ({ ...c, capacity: { ...c.capacity, bookedHours: n } }))} hint={props.app.bookedHours != null ? `App: ${props.app.bookedHours} h scheduled` : "App: no scheduled proposals to count"} />
          <Num label="Available hours, entered by hand" value={v.capacity.availableHours} disabled={!editable} onChange={(n) => set((c) => ({ ...c, capacity: { ...c.capacity, availableHours: n } }))} hint={`App: ${v.capacity.crews} × ${v.crew.hoursPerDay} h × ${v.capacity.workdaysPerWeek} d × ${v.capacity.windowWeeks} wk = ${v.capacity.crews * v.crew.hoursPerDay * v.capacity.workdaysPerWeek * v.capacity.windowWeeks} h`} />
        </Grid>
      </Section>

      <Section id="var-indirect" title="Indirect cost pool (IR = IC₉₀ ÷ PM₉₀)">
        <SourcePick value={v.indirect.source} disabled={!editable} onChange={(s) => set((c) => ({ ...c, indirect: { ...c.indirect, source: s } }))} />
        <Grid>
          <Num
            label="IC₉₀: indirect cost, last 90 days, entered by hand"
            prefix="$"
            value={v.indirect.ic90Cents / 100}
            disabled={!editable}
            onChange={(n) => set((c) => ({ ...c, indirect: { ...c.indirect, ic90Cents: Math.round(n * 100) } }))}
            hint={props.app.ic90Cents != null ? `App (bank feed): $${Math.round(props.app.ic90Cents / 100).toLocaleString("en-US")}` : "App: no bank feed in the last 90 days"}
          />
          <Num
            label="PM₉₀: elapsed project minutes, last 90 days, entered by hand"
            suffix="min"
            value={v.indirect.pm90Minutes}
            disabled={!editable}
            onChange={(n) => set((c) => ({ ...c, indirect: { ...c.indirect, pm90Minutes: n } }))}
            hint={props.app.pm90Minutes != null ? `App (crew clock): ${props.app.pm90Minutes.toLocaleString("en-US")} min` : "App: no clocked job time in the last 90 days"}
          />
        </Grid>
        <p className="mt-2 text-xs text-muted-foreground">
          IC₉₀ counts crew payroll, owned equipment over its useful life, vehicles, insurance, marketing, office, software, repairs and overhead; never a job&apos;s own materials, subs, rentals, delivery, disposal or permits.
          {props.app.notes.length > 0 && ` ${props.app.notes.join(" ")}`}
        </p>
      </Section>

      <Section id="var-crew" title="Crew">
        <Grid>
          <Num label="Leads" value={v.crew.leads} disabled={!editable} onChange={(n) => set((c) => ({ ...c, crew: { ...c.crew, leads: Math.round(n) } }))} />
          <Num label="Techs" value={v.crew.techs} disabled={!editable} onChange={(n) => set((c) => ({ ...c, crew: { ...c.crew, techs: Math.round(n) } }))} />
          <Num label="Paid day, drive included" suffix="h" value={v.crew.hoursPerDay} disabled={!editable} onChange={(n) => set((c) => ({ ...c, crew: { ...c.crew, hoursPerDay: n } }))} />
        </Grid>
      </Section>

      <Section id="var-travel" title="Travel">
        <Grid>
          <Num label="Drive each way when the map can't tell" suffix="min" value={v.travel.driveMinutesEachWay} disabled={!editable} onChange={(n) => set((c) => ({ ...c, travel: { ...c.travel, driveMinutesEachWay: n } }))} />
          <Num label="Material pickup stop" suffix="min" value={v.travel.pickupMinutes} disabled={!editable} onChange={(n) => set((c) => ({ ...c, travel: { ...c.travel, pickupMinutes: n } }))} />
          <Num label="Dump run, there and back" suffix="min" value={v.travel.disposalTripMinutes} disabled={!editable} onChange={(n) => set((c) => ({ ...c, travel: { ...c.travel, disposalTripMinutes: n } }))} />
          <Num label="Dump fee a load" prefix="$" value={v.travel.dumpFeeCents / 100} disabled={!editable} onChange={(n) => set((c) => ({ ...c, travel: { ...c.travel, dumpFeeCents: Math.round(n * 100) } }))} />
        </Grid>
      </Section>

      <Section id="var-logistics" title="Logistics minutes">
        <Grid>
          {(
            [
              ["setup", "Equipment setup, per day"],
              ["breakdown", "Equipment breakdown, per day"],
              ["smallUnload", "Small equipment unloading, per item"],
              ["largeUnload", "Large equipment unloading, per item"],
              ["stagingPerCy", "Material staging, per CY"],
              ["walkthrough", "Client walkthrough, per job"],
              ["inspection", "Final quality inspection, per job"],
              ["smallItemsPerDay", "Small items unloaded a day"],
              ["largeItemsPerDay", "Large items unloaded a day"],
            ] as [keyof PricingVariables["logistics"], string][]
          ).map(([key, label]) => (
            <Num key={key} label={label} suffix={/Items/.test(key) ? "" : "min"} value={v.logistics[key]} disabled={!editable} onChange={(n) => set((c) => ({ ...c, logistics: { ...c.logistics, [key]: n } }))} />
          ))}
        </Grid>
      </Section>

      <Section id="var-conditions" title="Condition multipliers (on labour minutes)">
        <div className="grid gap-3 sm:grid-cols-2">
          {CONDITIONS.map((def) => (
            <div key={def.key} className="rounded-lg border p-3">
              <p className="font-semibold">{def.label}</p>
              <p className="mb-2 text-xs text-muted-foreground">{def.appliesToLabel}</p>
              {def.options.map((o) => (
                <label key={o.value} className="flex items-center justify-between gap-2 py-0.5">
                  <span>{o.label}</span>
                  <SmallNum
                    value={v.conditions[def.key][o.value]}
                    suffix="×"
                    step={0.05}
                    disabled={!editable}
                    onChange={(n) => set((c) => ({ ...c, conditions: { ...c.conditions, [def.key]: { ...c.conditions[def.key as ConditionKey], [o.value]: n } } }))}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section id="var-rates" title={`Production rates (${v.rates.length}, provisional, one person)`}>
        <input className="mb-2 h-9 w-full max-w-xs rounded-md border px-2" placeholder="Find a task" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {categories.map((cat) => {
          const rows = shownRates.filter((r) => r.category === cat);
          if (rows.length === 0) return null;
          return (
            <div key={cat} className="mb-3">
              <h3 className="font-semibold">{cat}</h3>
              <table className="w-full">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="font-medium">Task</th>
                    <th className="font-medium">Unit</th>
                    <th className="font-medium">Units / labour-minute</th>
                    <th className="text-right font-medium">Minutes / unit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const seed = DEFAULT_VARIABLES.rates.find((x) => x.key === r.key);
                    return (
                      <tr key={r.key} className="border-t">
                        <td className="py-0.5">{r.task}</td>
                        <td className="py-0.5">{r.unit}</td>
                        <td className="py-0.5">
                          <SmallNum
                            value={r.unitsPerLaborMinute}
                            step={0.001}
                            disabled={!editable}
                            onChange={(n) => set((c) => ({ ...c, rates: c.rates.map((x) => (x.key === r.key ? { ...x, unitsPerLaborMinute: n } : x)) }))}
                          />
                          {seed && seed.unitsPerLaborMinute !== r.unitsPerLaborMinute && <span className="ml-1 text-xs text-muted-foreground">sheet {seed.unitsPerLaborMinute}</span>}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">{r.unitsPerLaborMinute > 0 ? (1 / r.unitsPerLaborMinute).toFixed(2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </Section>

      <Section id="var-materials" title="Material prices (read from the app)">
        <table className="w-full">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="font-medium">Material</th>
              <th className="font-medium">Price</th>
              <th className="font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {props.materials.map((m) => (
              <tr key={m.key} className="border-t">
                <td className="py-0.5">{m.name}</td>
                <td className="py-0.5 tabular-nums">{m.unitCents == null ? <span className="font-medium text-amber-700">price needed</span> : `$${(m.unitCents / 100).toFixed(2)} / ${m.unit}`}</td>
                <td className="py-0.5 text-muted-foreground">
                  {m.source}
                  {m.supplier ? ` (${m.supplier})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">Set on Admin › Bulk suppliers and Admin › Inventory. The supplier-linked inventory tracker replaces this list later.</p>
      </Section>

      <Section id="var-other" title="Everything else the business runs on">
        <table className="w-full">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="font-medium">Variable</th>
              <th className="font-medium">Value</th>
              <th className="font-medium">Changed at</th>
              <th className="font-medium">Lives in</th>
            </tr>
          </thead>
          <tbody>
            {props.others.map((o) => (
              <tr key={o.label} className="border-t align-top">
                <td className="py-1 pr-2">
                  <span className="text-xs text-muted-foreground">{o.group} · </span>
                  {o.label}
                </td>
                <td className="py-1 pr-2 tabular-nums">{o.value}</td>
                <td className="py-1 pr-2">{o.editAt ?? <span className="text-muted-foreground">code only</span>}</td>
                <td className="py-1 font-mono text-[11px] text-muted-foreground">{o.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : status}</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={pending} onClick={() => set(() => DEFAULT_VARIABLES)}>
                Starting figures
              </Button>
              <Button disabled={pending || !dirty} onClick={save}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-2 border-b pb-1 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Num(props: { label: string; value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number; disabled?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <span className="mt-0.5 flex items-center gap-1">
        {props.prefix && <span>{props.prefix}</span>}
        <SmallNum value={props.value} onChange={props.onChange} step={props.step} disabled={props.disabled} wide />
        {props.suffix && <span className="text-muted-foreground">{props.suffix}</span>}
      </span>
      {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
    </label>
  );
}

/** A number box that keeps what is being typed until it is a number. */
function SmallNum(props: { value: number; onChange: (n: number) => void; step?: number; suffix?: string; disabled?: boolean; wide?: boolean }) {
  const shown = Number.isFinite(props.value) ? String(Math.round(props.value * 100000) / 100000) : "";
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        step={props.step ?? "any"}
        disabled={props.disabled}
        className={`h-8 rounded-md border bg-card px-2 tabular-nums disabled:opacity-70 ${props.wide ? "w-32" : "w-24"}`}
        value={focused ? text : shown}
        onFocus={() => {
          setText(shown);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) props.onChange(n);
        }}
      />
      {props.suffix && <span className="text-muted-foreground">{props.suffix}</span>}
    </span>
  );
}

function SourcePick({ value, onChange, disabled }: { value: InputSource; onChange: (s: InputSource) => void; disabled?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap gap-3">
      {(
        [
          ["app", "From the app where it has data, else as entered"],
          ["manual", "Always as entered by hand"],
        ] as [InputSource, string][]
      ).map(([s, label]) => (
        <label key={s} className="flex items-center gap-1.5">
          <input type="radio" checked={value === s} disabled={disabled} onChange={() => onChange(s)} />
          {label}
        </label>
      ))}
    </div>
  );
}

function CommissionField({ k, label, unit, initial, disabled }: { k: CommissionKey; label: string; unit: string; initial: number; disabled: boolean }) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          step="any"
          disabled={disabled}
          className="h-8 w-32 rounded-md border bg-card px-2 tabular-nums disabled:opacity-70"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          onBlur={() => {
            if (value === initial || !Number.isFinite(value)) return;
            start(async () => {
              const res = await saveBackOfficeSetting(k, value);
              setNote(res.ok ? "Saved" : res.error);
            });
          }}
        />
        <span className="text-muted-foreground">{unit}</span>
      </span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </label>
  );
}
