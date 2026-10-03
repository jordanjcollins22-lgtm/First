import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";

import type { ManagedJob } from "@/lib/my-work";
import type { JobBucket } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const dayLabel = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** The piles, in the order they need somebody: the one waiting on a person first. */
const PILES: { bucket: JobBucket; title: string; what: string; urgent: boolean }[] = [
  { bucket: "needs_signoff", title: "Walk it and sign it off", what: "The crew has finished. Walk it, then sign it off.", urgent: true },
  { bucket: "unscheduled", title: "Needs a date", what: "Sold, with no day booked. Open it to book the crew.", urgent: true },
  { bucket: "working", title: "Underway", what: "The crew is on it.", urgent: false },
  { bucket: "scheduled", title: "Booked", what: "On the calendar, waiting for its day.", urgent: false },
];

/** What is waiting on the account manager, for the square's number. */
export function jobsNeedingYou(items: ManagedJob[]): { toWalk: number; toSchedule: number } {
  return {
    toWalk: items.filter((i) => i.bucket === "needs_signoff").length,
    toSchedule: items.filter((i) => i.bucket === "unscheduled").length,
  };
}

/**
 * The jobs an account manager runs, sold and not finished, in the order
 * they need them: walk and sign off, book a date, then what is underway
 * and what is booked. Each opens the job, where it is scheduled and run.
 */
export function JobManagement({ items, preview = false }: { items: ManagedJob[]; preview?: boolean }) {
  const href = (path: string) => (preview ? "#" : path);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Your jobs</h2>
        <Link href={href("/operations?tab=calendar")} className="flex items-center gap-1 text-sm font-medium text-primary">
          <CalendarDays className="h-4 w-4" /> Calendar
        </Link>
      </div>
      {items.length === 0 && <p className="rounded-xl border border-border bg-card/70 p-3 text-sm text-muted-foreground">No live jobs on your book right now.</p>}
      {PILES.map((pile) => {
        const here = items.filter((i) => i.bucket === pile.bucket).sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
        if (here.length === 0) return null;
        return (
          <div key={pile.bucket} className="flex flex-col gap-1.5">
            <div>
              <p className={cn("text-sm font-semibold", pile.urgent && "text-amber-800 dark:text-amber-300")}>
                {pile.title} ({here.length})
              </p>
              <p className="text-xs text-muted-foreground">{pile.what}</p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {here.map((job) => (
                <li key={job.jobId}>
                  <Link
                    href={href(`/jobs/${job.jobId}`)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 hover:bg-accent/50",
                      pile.urgent ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20" : "border-border bg-card/70"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{job.customerName}</span>
                        {job.value != null && job.value > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{money(job.value)}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{job.address}</span>
                      {job.date && <span className="block text-xs font-medium">{dayLabel(job.date)}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
