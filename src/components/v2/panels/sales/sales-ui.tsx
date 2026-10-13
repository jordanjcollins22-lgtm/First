import { AlertTriangle } from "lucide-react";

import type { EntityRef } from "@/lib/entities/types";
import type { Tone } from "@/lib/sales/scorecard";
import { OpenEntityButton } from "@/components/v2/panels/sales/open-entity-button";

/**
 * Pieces the three sales panels share: the needs-you strip, a KPI tile
 * coloured against its band, and a section heading. Server components, no
 * state.
 */

export const TONE_CLASS: Record<Tone, string> = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50",
  warn: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50",
  bad: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-50",
  neutral: "bg-card",
};

export const TONE_WORD: Record<Tone, string> = { good: "On target", warn: "Short of target", bad: "Off target", neutral: "Not enough data" };

export function PanelSection({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export function KpiTile({ label, value, target, tone, note }: { label: string; value: string; target: string; tone: Tone; note?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${TONE_CLASS[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 font-mono text-2xl">{value}</p>
      <p className="text-xs">
        <span className="font-semibold">{TONE_WORD[tone]}</span> · target {target}
      </p>
      {note && <p className="mt-1 text-[11px] leading-snug opacity-75">{note}</p>}
    </div>
  );
}

export interface StripItem {
  id: string;
  summary: string;
  detail?: string | null;
  who?: string | null;
  /** What Open shows in the drawer: the job, client or evaluator behind it. */
  open?: EntityRef | null;
  /** Buttons, from a client component. */
  actions?: React.ReactNode;
}

/** Only what needs a person, each with its way through. Says so plainly when there is nothing. */
export function NeedsYouStrip({ items, empty }: { items: StripItem[]; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 sm:flex-row sm:items-center dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
          <AlertTriangle className="hidden h-5 w-5 shrink-0 sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{item.summary}</p>
            {item.detail && <p className="whitespace-pre-line text-xs opacity-80">{item.detail}</p>}
            {item.who && <p className="text-xs opacity-80">For {item.who}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.open && <OpenEntityButton entity={item.open} />}
            {item.actions}
          </div>
        </li>
      ))}
    </ul>
  );
}

export const pct = (n: number | null, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
