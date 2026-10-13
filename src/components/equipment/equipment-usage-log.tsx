"use client";

import { useState, useTransition } from "react";

import { logEquipmentUsage } from "@/lib/actions/equipment-actions";

/**
 * The end-of-day equipment log: one line per machine, fill in only the ones
 * used today. Trucks take the odometer, mowers the hour meter, and anything
 * without a meter takes how long it ran. Sending it again replaces today's
 * figures rather than adding to them.
 */

export interface UsageLogMachine {
  id: string;
  name: string;
  meter: "miles" | "hours" | "none";
  /** What it read at the last log, shown as a hint. */
  current: number | null;
  /** What this person already logged today, so the form shows it. */
  loggedToday: number | null;
}

export function EquipmentUsageLog({ machines }: { machines: UsageLogMachine[] }) {
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(machines.map((m) => [m.id, m.loggedToday == null ? "" : String(m.loggedToday)]))
  );
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  if (machines.length === 0) return null;

  return (
    <form
      className="rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const entries = machines
          .filter((m) => (values[m.id] ?? "").trim() !== "")
          .map((m) => {
            const n = Number(values[m.id]);
            return m.meter === "none" ? { assetId: m.id, usedHours: n } : { assetId: m.id, reading: n };
          });
        start(async () => {
          const result = await logEquipmentUsage(entries);
          setSaid(result.ok ? { ok: true, text: result.message ?? "Logged." } : { ok: false, text: result.error });
        });
      }}
    >
      <h3 className="font-semibold">Equipment used today</h3>
      <p className="text-sm text-muted-foreground">Fill in only what you used. Leave the rest blank.</p>
      <ul className="mt-3 grid gap-2">
        {machines.map((m) => (
          <li key={m.id}>
            <label className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3">
              <span className="text-sm">
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.meter === "miles" ? "Odometer, miles" : m.meter === "hours" ? "Hour meter" : "Hours it ran today"}
                  {m.current != null && m.meter !== "none" && ` · last ${m.current.toLocaleString("en-US")}`}
                </span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={m.meter === "miles" ? 1 : 0.1}
                max={m.meter === "none" ? 24 : undefined}
                className="min-h-11 rounded-lg border bg-background px-2 text-base"
                value={values[m.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                aria-label={`${m.name}: ${m.meter === "miles" ? "odometer" : m.meter === "hours" ? "hour meter" : "hours run"}`}
              />
            </label>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log it"}
      </button>
      {said && <p className={`mt-2 text-sm ${said.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}`}>{said.text}</p>}
    </form>
  );
}
