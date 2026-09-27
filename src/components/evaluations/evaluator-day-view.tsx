import Link from "next/link";
import { ChevronRight, FileCheck2, FileQuestion, Phone } from "lucide-react";

import { VisitAction } from "@/components/evaluations/visit-action";
import type { EvaluatorDay, Visit } from "@/lib/data/evaluator-day";
import { cn } from "@/lib/utils";

const time = (at: string, timeZone: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
const day = (at: string, timeZone: string) => new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });

function FormChip({ sent }: { sent: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        sent ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground"
      )}
    >
      {sent ? <FileCheck2 className="h-3 w-3" /> : <FileQuestion className="h-3 w-3" />}
      {sent ? "Pre-eval filled out" : "No pre-eval yet"}
    </span>
  );
}

/**
 * The evaluator's day, as simple as it can be: today's visits, each with
 * the one button it needs next, then what is coming up, then anything
 * visited and not written up.
 */
export function EvaluatorDayView({ data, preview = false }: { data: EvaluatorDay; preview?: boolean }) {
  const { today, upcoming, toWriteUp, timeZone } = data;
  // In the walk-through nothing leads anywhere real.
  const hrefFor = (id: string) => (preview ? "#" : `/evaluate/${id}`);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Your evaluations</h1>
        {data.canSeeEveryone && (
          <div className="flex gap-1 text-sm">
            <Link href={preview ? "#" : "/evaluate"} className={cn("rounded-full px-3 py-1", !data.everyone ? "bg-primary text-primary-foreground" : "border border-border")}>
              Mine
            </Link>
            <Link href={preview ? "#" : "/evaluate?all=1"} className={cn("rounded-full px-3 py-1", data.everyone ? "bg-primary text-primary-foreground" : "border border-border")}>
              Everyone
            </Link>
          </div>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Today</h2>
        {today.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No evaluations today.</p>
        ) : (
          today.map((visit) => <TodayCard key={visit.id} visit={visit} timeZone={timeZone} href={hrefFor(visit.id)} preview={preview} />)
        )}
      </section>

      {toWriteUp.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Not written up yet</h2>
          <p className="-mt-1 text-sm text-muted-foreground">Visited, and the site map has not been submitted.</p>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-amber-500/50 bg-card">
            {toWriteUp.map((visit) => (
              <Row key={visit.id} visit={visit} when={day(visit.evaluationDate, timeZone)} action="Write it up" href={hrefFor(visit.id)} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing booked in the next three weeks.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {upcoming.map((visit) => (
              <Row key={visit.id} visit={visit} when={`${day(visit.evaluationDate, timeZone)} · ${time(visit.evaluationDate, timeZone)}`} href={hrefFor(visit.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TodayCard({ visit, timeZone, href, preview }: { visit: Visit; timeZone: string; href: string; preview: boolean }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <Link href={href} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{time(visit.evaluationDate, timeZone)}</p>
          <p className="text-lg font-bold leading-tight">{visit.clientName}</p>
          <p className="text-sm text-muted-foreground">{visit.address}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <FormChip sent={visit.formSent} />
            {visit.evaluatorName && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{visit.evaluatorName}</span>}
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
      <div className="flex flex-col gap-2">
        <VisitAction jobId={visit.id} stage={visit.stage} timeZone={timeZone} preview={preview} />
        {visit.stage === "arrived" && (
          <Link href={href} className="inline-flex h-12 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
            Open the visit
          </Link>
        )}
        {visit.phone && (
          <a href={`tel:${visit.phone}`} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary">
            <Phone className="h-4 w-4" /> Call {visit.clientName.split(/\s+/)[0]}
          </a>
        )}
      </div>
    </article>
  );
}

function Row({ visit, when, action, href }: { visit: Visit; when: string; action?: string; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">{when}</p>
          <p className="font-medium">{visit.clientName}</p>
          <p className="truncate text-sm text-muted-foreground">{visit.address}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <FormChip sent={visit.formSent} />
            {visit.evaluatorName && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{visit.evaluatorName}</span>}
          </div>
        </div>
        {action ? <span className="shrink-0 text-sm font-semibold text-primary">{action}</span> : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
      </Link>
    </li>
  );
}
