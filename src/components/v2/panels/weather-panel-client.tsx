"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  applyWeatherProposal,
  dismissWeatherProposal,
  runWeatherCheckNow,
  saveWeatherSettings,
  setCoverExisting,
  type WeatherActionResult,
} from "@/lib/actions/weather-actions";

/** The weather panel's interactive parts: a proposal's two buttons, and the settings. */

function Result({ result }: { result: WeatherActionResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

export function ProposalActions({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<WeatherActionResult | null>(null);
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await applyWeatherProposal(ids)))}>
          Move them
        </Button>
        <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await dismissWeatherProposal(ids)))}>
          Keep as booked
        </Button>
      </div>
      <Result result={result} />
    </div>
  );
}

export interface WeatherSettingsView {
  ready: boolean;
  cascadeEnabled: boolean;
  cascadeStartedAt: string | null;
  coverExisting: boolean;
  autoApply: boolean;
  maxAutoShiftDays: number;
  maxAutoMoves: number;
  workWeekdays: number[];
  mowRainIn: number;
  installRainIn: number;
  rainChanceMin: number;
  heavyRainIn: number;
  saturatedDays: number;
  notifyClients: boolean;
  notifyCrew: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeatherSettingsForm({ settings }: { settings: WeatherSettingsView }) {
  const [form, setForm] = useState(settings);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<WeatherActionResult | null>(null);
  const set = <K extends keyof WeatherSettingsView>(key: K, value: WeatherSettingsView[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () =>
    start(async () =>
      setResult(
        await saveWeatherSettings({
          cascadeEnabled: form.cascadeEnabled,
          autoApply: form.autoApply,
          maxAutoShiftDays: Number(form.maxAutoShiftDays),
          maxAutoMoves: Number(form.maxAutoMoves),
          workWeekdays: form.workWeekdays,
          mowRainIn: Number(form.mowRainIn),
          installRainIn: Number(form.installRainIn),
          rainChanceMin: Number(form.rainChanceMin),
          heavyRainIn: Number(form.heavyRainIn),
          saturatedDays: Number(form.saturatedDays),
          notifyClients: form.notifyClients,
          notifyCrew: form.notifyCrew,
        })
      )
    );

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">The cascade</h3>
        <p className="text-xs text-muted-foreground">
          {form.cascadeEnabled
            ? `On${settings.cascadeStartedAt ? ` since ${new Date(settings.cascadeStartedAt).toLocaleDateString()}` : ""}. Checks every three hours.`
            : "Off. Nothing is moved and nobody is told."}
          {settings.lastRunAt && ` Last check ${new Date(settings.lastRunAt).toLocaleString()}${settings.lastRunSummary ? `: ${settings.lastRunSummary}` : "."}`}
        </p>
      </div>

      <Toggle label="Move rained-out days automatically" hint="Off means nothing moves and nobody is told." checked={form.cascadeEnabled} onChange={(v) => set("cascadeEnabled", v)} />
      <Toggle
        label="Make moves inside the limits without asking"
        hint="Over the limits, the moves wait at the top of this panel and the project lead gets an exception."
        checked={form.autoApply}
        onChange={(v) => set("autoApply", v)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Furthest a visit may move without asking (days)" value={form.maxAutoShiftDays} step={1} onChange={(v) => set("maxAutoShiftDays", v)} />
        <NumberField label="Most visits moved in one run without asking" value={form.maxAutoMoves} step={1} onChange={(v) => set("maxAutoMoves", v)} />
        <NumberField label="Mowing stops at (inches of rain)" value={form.mowRainIn} step={0.05} onChange={(v) => set("mowRainIn", v)} />
        <NumberField label="Installs stop at (inches of rain)" value={form.installRainIn} step={0.05} onChange={(v) => set("installRainIn", v)} />
        <NumberField label="Only count rain at or over this chance (%)" value={form.rainChanceMin} step={5} onChange={(v) => set("rainChanceMin", v)} />
        <NumberField label="Heavy rain that soaks the ground (inches)" value={form.heavyRainIn} step={0.25} onChange={(v) => set("heavyRainIn", v)} />
        <NumberField label="Days the ground stays too wet after it" value={form.saturatedDays} step={1} onChange={(v) => set("saturatedDays", v)} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Days a moved visit may land on</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((label, day) => {
            const on = form.workWeekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => set("workWeekdays", on ? form.workWeekdays.filter((d) => d !== day) : [...form.workWeekdays, day])}
                className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm ${on ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Toggle label="Text or email the client when their visit moves" checked={form.notifyClients} onChange={(v) => set("notifyClients", v)} />
      <Toggle label="Tell the crew on the job" checked={form.notifyCrew} onChange={(v) => set("notifyCrew", v)} />

      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending || !settings.ready} onClick={save}>
          Save
        </Button>
        <Button variant="secondary" className="min-h-11" disabled={pending || !settings.ready} onClick={() => start(async () => setResult(await runWeatherCheckNow()))}>
          Check the forecast now
        </Button>
      </div>

      <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
        <p className="font-medium">Work booked before the cascade was switched on</p>
        <p className="text-xs text-muted-foreground">
          {form.coverExisting
            ? "Included: the cascade moves it like anything else."
            : "Left alone: only visits booked or changed since the switch went on are moved. Include the rest as a one-off if you want the whole calendar covered."}
        </p>
        <div>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending || !settings.ready}
            onClick={() =>
              start(async () => {
                const r = await setCoverExisting(!form.coverExisting);
                if (r.ok) set("coverExisting", !form.coverExisting);
                setResult(r);
              })
            }
          >
            {form.coverExisting ? "Leave older bookings alone" : "Include older bookings"}
          </Button>
        </div>
      </div>

      <Result result={result} />
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 rounded-lg border bg-background px-3"
      />
    </label>
  );
}
