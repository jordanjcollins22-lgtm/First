import Link from "next/link";

import { JOB_BUCKETS } from "@/lib/dashboard";
import { SUBMIT_BLURBS, SUBMIT_LABELS, type ManagedJob, type SubmissionDue, type SubmitReason, type UpcomingEvaluation } from "@/lib/my-work";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dayLabel(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function time(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const EVAL_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "On site",
};

const JOB_LABELS = new Map(JOB_BUCKETS.map((b) => [b.key, b.label]));

/**
 * What is coming, grouped by the day it lands on.
 *
 * Grouped rather than listed flat because the question is "what does Thursday
 * look like", and a flat list of fourteen appointments makes somebody count
 * dates in their head to answer it.
 */
export function UpcomingEvaluations({ items }: { items: UpcomingEvaluation[] }) {
  const days: { key: string; items: UpcomingEvaluation[] }[] = [];
  for (const item of items) {
    const last = days[days.length - 1];
    if (last && last.key === item.day) last.items.push(item);
    else days.push({ key: item.day, items: [item] });
  }

  return (
    <section className="mb-6">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Upcoming evaluations</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Every visit still to happen, soonest first.</p>

      {items.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Nothing booked ahead. That is either a quiet fortnight or a gap worth filling.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {days.map((day) => (
            <div key={day.key}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {day.items[0].isToday ? `Today · ${dayLabel(day.key)}` : dayLabel(day.key)}
              </p>
              <ul className="flex flex-col gap-1.5">
                {day.items.map((item) => (
                  <li key={item.jobId}>
                    <Link
                      href={`/jobs/${item.jobId}`}
                      className={`block rounded-lg border p-2.5 hover:bg-accent/50 ${
                        item.isToday
                          ? "border-primary/40 bg-primary/5"
                          : "border-white/60 bg-card/60 backdrop-blur-md"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{item.customerName}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {time(item.at)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.address}</p>
                      {item.status !== "scheduled" && (
                        <p className="text-[11px] font-semibold text-primary">
                          {EVAL_STATUS_LABELS[item.status] ?? item.status}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The paperwork queue.
 *
 * Grouped by what the next action is, because that is the only grouping that
 * turns a list into a to-do. Days waiting is on every row: a visit from
 * yesterday and one from three weeks ago are the same line otherwise, and they
 * are not the same problem.
 */
export function NeedsSubmitting({ items }: { items: SubmissionDue[] }) {
  const reasons: SubmitReason[] = ["close_out", "price_it", "send_it"];

  return (
    <section className="mb-6">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Needs submitting</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Work you have already done that nobody downstream can see yet.
      </p>

      {items.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Nothing outstanding. Every visit is closed out, priced and sent.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {reasons.map((reason) => {
            const group = items.filter((i) => i.reason === reason);
            if (group.length === 0) return null;

            return (
              <div
                key={reason}
                className="rounded-xl border border-amber-400/70 bg-amber-50/60 p-3 backdrop-blur-md"
              >
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{SUBMIT_LABELS[reason]}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{group.length}</span>
                </div>
                <p className="mb-2 text-[11px] text-muted-foreground">{SUBMIT_BLURBS[reason]}</p>

                <ul className="flex flex-col gap-1.5">
                  {group.map((item) => (
                    <li key={item.jobId}>
                      <Link
                        href={`/jobs/${item.jobId}`}
                        className="block rounded-lg border border-border bg-background/60 p-2.5 hover:bg-accent/50"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{item.customerName}</span>
                          {item.daysWaiting != null && item.daysWaiting > 0 && (
                            <span
                              className={`shrink-0 text-xs tabular-nums ${
                                item.daysWaiting >= 7 ? "font-semibold text-amber-800" : "text-muted-foreground"
                              }`}
                            >
                              {item.daysWaiting}d
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{item.address}</p>
                        {item.since && (
                          <p className="text-[11px] text-muted-foreground">Visited {dayLabel(item.since)}</p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Live work, on site first. Finished and cancelled jobs are not "ongoing",
 * and one still out for a decision is the client's move, not theirs. */
export function ManagedJobs({ items }: { items: ManagedJob[] }) {
  const total = items.reduce((sum, i) => sum + (i.value ?? 0), 0);

  return (
    <section className="mb-6">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Jobs you&apos;re managing</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {items.length}
          {total > 0 && ` · ${money(total)}`}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Sold work that isn&apos;t finished.</p>

      {items.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          No live jobs on your book right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.jobId}>
              <Link
                href={`/jobs/${item.jobId}`}
                className={`block rounded-lg border p-2.5 backdrop-blur-md hover:bg-accent/50 ${
                  item.bucket === "needs_signoff"
                    ? "border-amber-400/70 bg-amber-50/60"
                    : "border-white/60 bg-card/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{item.customerName}</span>
                  {item.value != null && item.value > 0 && (
                    <span className="shrink-0 text-xs tabular-nums">{money(item.value)}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{item.address}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span
                    className={item.bucket === "needs_signoff" ? "font-semibold text-amber-800" : "font-medium"}
                  >
                    {JOB_LABELS.get(item.bucket) ?? item.bucket}
                  </span>
                  {item.date && <span>{dayLabel(item.date)}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
