import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { EntityRef } from "@/lib/entities/types";

import { OpenInDrawer } from "./marketing-open";

/**
 * The three layers every marketing panel shares: what needs a person, the
 * numbers against target, and the machinery underneath. Server components.
 */

export interface NeedsYouItem {
  key: string;
  text: string;
  /** Where to go to deal with it, when it is somewhere else in the new layout. */
  href?: string;
  /** Or what to open in the drawer to deal with it there. */
  open?: EntityRef;
  action?: string;
}

export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return (
      <p className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed px-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" /> Nothing needs you here.
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5" aria-label="Needs you">
      {items.map((i) => (
        <li key={i.key} className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="flex-1">{i.text}</span>
          {i.open ? (
            <OpenInDrawer entity={i.open}>{i.action ?? "Open"}</OpenInDrawer>
          ) : i.href && (
            <a href={i.href} className="inline-flex min-h-9 items-center rounded-lg border bg-card px-3 text-sm font-semibold hover:bg-muted">
              {i.action ?? "Open"}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export type Tone = "good" | "warn" | "bad" | "none";

const TONE: Record<Tone, string> = {
  good: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
  warn: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  bad: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  none: "bg-card",
};

export function Kpi({ label, value, target, tone = "none" }: { label: string; value: string; target?: string; tone?: Tone }) {
  return (
    <div className={`rounded-xl border p-3 ${TONE[tone]}`}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p>
      {target && <p className="text-xs text-muted-foreground">Target {target}</p>}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card/60 p-4">
      <div>
        <h3 className="text-base font-extrabold">{title}</h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function NotConnected({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
      {what}: Not connected — add it in Settings › Integrations.
    </p>
  );
}

export function pct(v: number | null, digits = 0): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}
