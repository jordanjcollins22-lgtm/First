"use client";

import { useState, useTransition } from "react";

import {
  dismissEquipmentAlert,
  recordService,
  saveAssetMeter,
  saveEquipmentSettings,
  saveServiceInterval,
  type ActionResult,
  type EquipmentSettingsPatch,
} from "@/lib/actions/equipment-actions";
import type { AssetRow, EquipmentSettings } from "@/lib/data/equipment";
import { EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABEL, type Meter, type ServiceInterval } from "@/lib/equipment/maintenance";

/** The interactive parts of the Equipment panel. */

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const field = "min-h-11 rounded-lg border bg-background px-2 text-sm";

function useAction() {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const result = await fn();
      setSaid(result.ok ? { ok: true, text: result.message ?? "Done." } : { ok: false, text: result.error });
      if (result.ok) after?.();
    });
  return { pending, said, run };
}

function Said({ said }: { said: { ok: boolean; text: string } | null }) {
  if (!said) return null;
  return <p className={`mt-2 text-sm ${said.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}`}>{said.text}</p>;
}

const today = () => new Date().toLocaleDateString("en-CA");
const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

/* -------------------------------------------------------------------------
 * Marking a task done
 * ---------------------------------------------------------------------- */

export function MarkDone({ assetId, task, meter }: { assetId: string; task: string; meter: Meter }) {
  const [open, setOpen] = useState(false);
  const { pending, said, run } = useAction();
  return (
    <div>
      {!open ? (
        <button type="button" className={btn} onClick={() => setOpen(true)}>
          Log done
        </button>
      ) : (
        <form
          className="grid gap-2 rounded-lg bg-muted p-2 sm:grid-cols-[9rem_8rem_7rem_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            run(
              () =>
                recordService({
                  assetId,
                  task,
                  doneOn: String(d.get("doneOn")),
                  atHours: meter === "hours" || meter === "none" ? numOrNull(d.get("reading")) : null,
                  atMiles: meter === "miles" ? numOrNull(d.get("reading")) : null,
                  costDollars: numOrNull(d.get("cost")),
                }),
              () => setOpen(false)
            );
          }}
        >
          <label className="grid gap-1 text-xs">
            Done on
            <input name="doneOn" type="date" defaultValue={today()} max={today()} className={field} required />
          </label>
          <label className="grid gap-1 text-xs">
            {meter === "miles" ? "Odometer" : "Hours"} (blank = now)
            <input name="reading" type="number" min={0} step="0.1" inputMode="decimal" className={field} />
          </label>
          <label className="grid gap-1 text-xs">
            Cost ($)
            <input name="cost" type="number" min={0} step="0.01" inputMode="decimal" className={field} />
          </label>
          <button type="submit" className={primary} disabled={pending}>
            Save
          </button>
          <button type="button" className={btn} onClick={() => setOpen(false)}>
            Close
          </button>
        </form>
      )}
      <Said said={said} />
    </div>
  );
}

export function DismissAlert({ id }: { id: string }) {
  const { pending, said, run } = useAction();
  return (
    <span>
      <button
        type="button"
        className={btn}
        disabled={pending}
        onClick={() => {
          const why = window.prompt("Why dismiss this? (e.g. sold, out of service for winter)");
          if (why) run(() => dismissEquipmentAlert(id, why));
        }}
      >
        Dismiss
      </button>
      <Said said={said} />
    </span>
  );
}

/* -------------------------------------------------------------------------
 * A machine's type and meter
 * ---------------------------------------------------------------------- */

export function AssetMeterForm({ asset }: { asset: AssetRow }) {
  const { pending, said, run } = useAction();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const meter = String(d.get("meter")) as Meter;
        const reading = numOrNull(d.get("reading"));
        run(() =>
          saveAssetMeter({
            assetId: asset.id,
            equipmentType: String(d.get("type")) || null,
            meter,
            ...(meter === "miles" ? { mileage: reading } : meter === "hours" || meter === "none" ? { engineHours: reading } : {}),
          })
        );
      }}
    >
      <span className="text-sm">
        <span className="font-medium">{asset.name}</span>
        <span className="block text-xs text-muted-foreground">{[asset.year, asset.make, asset.model].filter(Boolean).join(" ")}</span>
      </span>
      <label className="grid gap-1 text-xs">
        Type
        <select name="type" defaultValue={asset.equipmentType ?? asset.kind} className={field}>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Meter
        <select name="meter" defaultValue={asset.meter} className={field}>
          <option value="miles">Odometer (miles)</option>
          <option value="hours">Hour meter</option>
          <option value="none">No meter (log hours run)</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Reads now
        <input name="reading" type="number" min={0} step="0.1" defaultValue={(asset.meter === "miles" ? asset.mileage : asset.engineHours) ?? ""} className={field} />
      </label>
      <button type="submit" className={btn} disabled={pending}>
        Save
      </button>
      <Said said={said} />
    </form>
  );
}

/* -------------------------------------------------------------------------
 * Intervals
 * ---------------------------------------------------------------------- */

export function IntervalRow({ interval, label }: { interval: ServiceInterval; label: string }) {
  const { pending, said, run } = useAction();
  return (
    <form
      className="grid gap-2 rounded-lg bg-muted p-2 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_7rem_6rem_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        run(() =>
          saveServiceInterval({
            id: interval.id,
            assetId: interval.assetId,
            equipmentType: interval.equipmentType,
            task: interval.task,
            everyHours: numOrNull(d.get("hours")),
            everyMiles: numOrNull(d.get("miles")),
            everyDays: numOrNull(d.get("days")),
            active: d.get("active") === "on",
          })
        );
      }}
    >
      <span>
        <span className="font-medium">{interval.task}</span>
        <span className="block text-xs text-muted-foreground">
          {label}
          {interval.isDefault && " · default, adjust to your manual"}
        </span>
      </span>
      <label className="grid gap-1 text-xs">
        Hours
        <input name="hours" type="number" min={0} step="1" defaultValue={interval.everyHours ?? ""} className={field} />
      </label>
      <label className="grid gap-1 text-xs">
        Miles
        <input name="miles" type="number" min={0} step="100" defaultValue={interval.everyMiles ?? ""} className={field} />
      </label>
      <label className="grid gap-1 text-xs">
        Days
        <input name="days" type="number" min={0} step="1" defaultValue={interval.everyDays ?? ""} className={field} />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-xs">
        <input name="active" type="checkbox" defaultChecked={interval.active} /> On
      </label>
      <button type="submit" className={btn} disabled={pending}>
        Save
      </button>
      <Said said={said} />
    </form>
  );
}

export function NewInterval({ assets }: { assets: AssetRow[] }) {
  const { pending, said, run } = useAction();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_6rem_7rem_6rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = new FormData(form);
        const target = String(d.get("target"));
        run(
          () =>
            saveServiceInterval({
              assetId: target.startsWith("asset:") ? target.slice(6) : null,
              equipmentType: target.startsWith("type:") ? target.slice(5) : null,
              task: String(d.get("task") ?? ""),
              everyHours: numOrNull(d.get("hours")),
              everyMiles: numOrNull(d.get("miles")),
              everyDays: numOrNull(d.get("days")),
            }),
          () => form.reset()
        );
      }}
    >
      <label className="grid gap-1 text-xs">
        For
        <select name="target" className={field} defaultValue="type:mower">
          <optgroup label="Every machine of a type">
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={`type:${t}`}>
                Every {EQUIPMENT_TYPE_LABEL[t].toLowerCase()}
              </option>
            ))}
          </optgroup>
          <optgroup label="One machine">
            {assets.map((a) => (
              <option key={a.id} value={`asset:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        Task
        <input name="task" required placeholder="e.g. Belt inspection" className={field} />
      </label>
      <label className="grid gap-1 text-xs">
        Hours
        <input name="hours" type="number" min={0} className={field} />
      </label>
      <label className="grid gap-1 text-xs">
        Miles
        <input name="miles" type="number" min={0} className={field} />
      </label>
      <label className="grid gap-1 text-xs">
        Days
        <input name="days" type="number" min={0} className={field} />
      </label>
      <button type="submit" className={primary} disabled={pending}>
        Add
      </button>
      <Said said={said} />
    </form>
  );
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

function Switch({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
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

export function EquipmentSettingsForm({ settings }: { settings: EquipmentSettings }) {
  const { pending, said, run } = useAction();
  const save = (patch: EquipmentSettingsPatch) => run(() => saveEquipmentSettings(patch));
  const since = (at: string | null) => (at ? ` On since ${at.slice(0, 10)}.` : "");
  return (
    <div>
      <Switch
        label="Overdue service becomes an alert for the project lead"
        hint={`Only for service that falls overdue after this is switched on, so the existing backlog doesn't page anybody.${since(settings.maintenanceStartedAt)}`}
        checked={settings.maintenanceAlertsEnabled}
        disabled={pending}
        onChange={(v) => save({ maintenanceAlertsEnabled: v })}
      />
      <Switch
        label="Fill in each new visit's kits from the services sold"
        hint={`Visits created after this is switched on, with no kits picked yet. A person can still change them.${since(settings.kitDeriveStartedAt)}`}
        checked={settings.kitDeriveEnabled}
        disabled={pending}
        onChange={(v) => save({ kitDeriveEnabled: v })}
      />
      <Switch
        label="Load-out not checked before departure becomes an exception"
        hint={`${settings.loadoutGraceMinutes} minutes after the shop arrival time, for anybody with things to load who hasn't ticked them and hasn't left.${since(settings.loadoutStartedAt)}`}
        checked={settings.loadoutWatchEnabled}
        disabled={pending}
        onChange={(v) => save({ loadoutWatchEnabled: v })}
      />
      <form
        className="mt-2 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          save({ loadoutGraceMinutes: Number(d.get("grace")), dueSoonDays: Number(d.get("soon")) });
        }}
      >
        <label className="grid gap-1 text-sm">
          Load-out grace (minutes)
          <input name="grace" type="number" min={0} max={600} defaultValue={settings.loadoutGraceMinutes} className={`${field} w-28`} />
        </label>
        <label className="grid gap-1 text-sm">
          &quot;Due soon&quot; looks ahead (days)
          <input name="soon" type="number" min={0} max={120} defaultValue={settings.dueSoonDays} className={`${field} w-28`} />
        </label>
        <button type="submit" className={btn} disabled={pending}>
          Save
        </button>
      </form>
      <Said said={said} />
    </div>
  );
}
