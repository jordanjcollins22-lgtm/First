import type { Kpi, Tone } from "@/lib/ops/kpis";
import type { BudgetMeter } from "@/lib/ops/job-cost";

/** Small server-rendered pieces the operations panels share. */

const TONE: Record<Tone, string> = {
  good: "border-green-300 dark:border-green-800",
  warn: "border-yellow-300 dark:border-yellow-700",
  bad: "border-red-300 dark:border-red-800",
  none: "",
};

const DOT: Record<Tone, string> = {
  good: "bg-green-600",
  warn: "bg-yellow-500",
  bad: "bg-red-600",
  none: "bg-muted-foreground/40",
};

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {kpis.map((k) => (
        <div key={k.key} className={`rounded-xl border bg-card p-4 ${TONE[k.tone]}`}>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[k.tone]}`} aria-hidden />
            {k.label}
          </p>
          <p className="mt-1 font-mono text-2xl">{k.value}</p>
          <p className="text-xs text-muted-foreground">Target {k.target}</p>
          {k.detail && <p className="mt-1 text-xs text-muted-foreground">{k.detail}</p>}
        </div>
      ))}
    </div>
  );
}

const BAR: Record<BudgetMeter["tone"], string> = {
  good: "bg-green-600",
  warn: "bg-yellow-500",
  over: "bg-red-600",
  unknown: "bg-muted-foreground/40",
};

/** Hours used against hours budgeted, as a bar. Hours only, never money. */
export function BudgetBar({ meter, label }: { meter: BudgetMeter; label: string }) {
  const pct = meter.usedPct == null ? 0 : Math.min(100, meter.usedPct);
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-semibold">{label}</span>
        <span className="shrink-0 font-mono">
          {meter.usedHours}h{meter.budgetHours != null ? ` / ${meter.budgetHours}h` : ""}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.usedPct ?? 0} aria-label={label}>
        <div className={`h-full ${BAR[meter.tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`text-xs ${meter.tone === "over" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>{meter.line}</p>
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h3 className="text-lg font-bold">{children}</h3>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function NotReady() {
  return (
    <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      The project automations aren&apos;t set up in the database yet. Nothing here runs until they are.
    </p>
  );
}

export function shortDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}
