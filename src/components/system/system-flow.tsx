import Link from "next/link";
import { ArrowDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { STATUS_LABEL, SYSTEM_FLOW, type SystemSquare, type SystemStatus } from "@/lib/system-flow";

const DOT: Record<SystemStatus, string> = {
  live: "bg-emerald-500",
  partly: "bg-amber-500",
  "not-built": "bg-muted-foreground/40",
};

/**
 * Every system, one small square each, in the order a customer meets them.
 * A square opens where that system is run; one that is not built yet says so
 * and opens nothing.
 */
export function SystemFlow({ jobLinks = { proposal: null } }: { jobLinks?: { proposal: string | null } }) {
  let step = 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Tap a square to open it.</p>
      {SYSTEM_FLOW.map((stage, i) => (
        <section key={stage.key} className="flex flex-col gap-2">
          {i > 0 && <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden />}
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.title}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stage.squares.map((square) => {
              // Marketing runs side by side; everything after it is one line, numbered.
              const number = stage.key === "marketing" ? null : ++step;
              return (
                <li key={square.key}>
                  <Square square={{ ...square, href: (square.onJob && jobLinks[square.onJob]) || square.href }} number={number} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <Legend />
    </div>
  );
}

function Square({ square, number }: { square: SystemSquare; number: number | null }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        {number != null ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {number}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", DOT[square.status])} aria-hidden />
          {STATUS_LABEL[square.status]}
        </span>
      </span>
      <span className="mt-1.5 flex items-start justify-between gap-1 text-sm font-semibold leading-snug">
        {square.title}
        {square.href && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      </span>
      <span className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">{square.line}</span>
      {square.gap && <span className="mt-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-400">{square.gap}</span>}
    </>
  );
  const box = cn(
    "flex h-full min-h-[7.5rem] flex-col rounded-xl border p-2.5",
    square.status === "not-built" ? "border-dashed border-border bg-transparent" : "border-border bg-card",
    square.href && "transition-colors hover:border-primary/50 hover:bg-accent/40"
  );
  return square.href ? (
    <Link href={square.href} className={box} title={square.line}>
      {body}
    </Link>
  ) : (
    <div className={box} title={square.line}>
      {body}
    </div>
  );
}

function Legend() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {(Object.keys(STATUS_LABEL) as SystemStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", DOT[s])} aria-hidden />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </p>
  );
}
