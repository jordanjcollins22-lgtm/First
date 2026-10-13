import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { BackOfficeItem } from "@/lib/data/back-office-queue";
import { backOfficeRef } from "@/lib/entities/handlers/admin-format";
import { OpenButton } from "./admin-open";

/**
 * The layout pieces the back-office panels share, rendered on the server:
 * the needs-you strip at the top (each item opens in the drawer), the KPI
 * tiles, and the automation card.
 */

/** The strip of things that need a person. Empty is a good answer and says so. */
export function NeedsYouStrip({ items, renderAction }: { items: BackOfficeItem[]; renderAction?: (item: BackOfficeItem) => ReactNode }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" /> Nothing needs you here.
      </div>
    );
  }
  return (
    <ul className="grid gap-2">
      {items.map((item) => {
        const ref = backOfficeRef(item.key);
        return (
          <li key={item.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 dark:border-orange-800 dark:bg-orange-950/40">
            <AlertTriangle className="h-4 w-4 shrink-0 text-orange-700 dark:text-orange-300" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{item.title}</p>
              {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
            </div>
            {renderAction?.(item)}
            {ref && <OpenButton kind={ref.kind} id={ref.id} />}
          </li>
        );
      })}
    </ul>
  );
}

export type Tone = "good" | "warn" | "bad" | "plain";

const TONE: Record<Tone, string> = {
  good: "border-green-300 dark:border-green-800",
  warn: "border-yellow-300 dark:border-yellow-800",
  bad: "border-red-300 dark:border-red-800",
  plain: "",
};

/** One KPI against its target, coloured green, yellow or red. */
export function Kpi({ label, value, target, tone }: { label: string; value: string; target?: string; tone: Tone }) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${TONE[tone]}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl">{value}</p>
      {target && <p className="text-xs text-muted-foreground">Target {target}</p>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>;
}

/** An automation: what it does, whether it is on, since when, and its settings. */
export function AutomationCard({ title, how, on, since, children }: { title: string; how: string; on: boolean; since: string | null; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-bold">{title}</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100" : "bg-muted text-muted-foreground"}`}>
          {on ? "On" : "Off"}
        </span>
        {on && since && <span className="text-xs text-muted-foreground">since {new Date(since).toLocaleDateString("en-US")}</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{how}</p>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

export function NotReady({ what }: { what: string }) {
  return (
    <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      {what} needs migration 0364_back_office.sql applied before it can be used.
    </p>
  );
}

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
