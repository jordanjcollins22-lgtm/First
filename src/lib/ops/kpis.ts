/**
 * The Projects page's numbers, against the report's planning targets.
 *
 * Targets are planning bands, mostly from vendors (see the playbook's KPI
 * table), not standards. Green, yellow, red is a prompt to look, not a grade.
 */

export type Tone = "good" | "warn" | "bad" | "none";

export interface Kpi {
  key: string;
  label: string;
  value: string;
  target: string;
  tone: Tone;
  detail: string | null;
}

export interface SessionOutcome {
  endsOn: string;
  status: string;
  /** Business-time day it was closed, when it was. */
  closedOn: string | null;
}

/** Share of finished work days closed on (or before) their last day. */
export function onTimePct(sessions: readonly SessionOutcome[]): { pct: number | null; of: number } {
  const counted = sessions.filter((s) => s.status !== "cancelled");
  if (counted.length === 0) return { pct: null, of: 0 };
  const onTime = counted.filter((s) => s.status === "done" && s.closedOn != null && s.closedOn <= s.endsOn).length;
  return { pct: Math.round((onTime / counted.length) * 100), of: counted.length };
}

export function toneAtLeast(value: number | null, good: number, warn: number): Tone {
  if (value == null) return "none";
  if (value >= good) return "good";
  if (value >= warn) return "warn";
  return "bad";
}

export function toneAtMost(value: number | null, good: number, warn: number): Tone {
  if (value == null) return "none";
  if (value <= good) return "good";
  if (value <= warn) return "warn";
  return "bad";
}

export function money(cents: number | null): string {
  if (cents == null) return "–";
  const dollars = cents / 100;
  return `${dollars < 0 ? "-" : ""}$${Math.abs(dollars).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function hours(h: number | null): string {
  return h == null ? "–" : `${Math.round(h * 10) / 10}h`;
}
