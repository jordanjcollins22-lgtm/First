import { Suspense } from "react";
import { AlertTriangle, CalendarClock, Check, Clock, Package, Phone, Snowflake, Users } from "lucide-react";

import { AutoRefresh } from "@/components/crew/auto-refresh";
import { CrewDay, type CrewDayContext } from "@/components/crew/crew-day";
import { NextUpCard } from "@/components/crew/next-up-card";
import { WorkOrderView } from "@/components/job/work-order-view";
import { ReportException } from "@/components/exceptions/report-exception";
import { SnowStopLogger } from "@/components/snow/snow-stop-logger";
import { BudgetBar } from "@/components/v2/panels/ops-shared";
import { CloseOutCard, StopSheets } from "@/components/v2/panels/role/operations-parts";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { getActiveSnowRoute } from "@/lib/data/snow-ops";
import { getLeadDay } from "@/lib/data/lead-day";
import { readDay } from "@/lib/crew-day";
import { canRunJobs, hasRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { CrewTone } from "@/lib/lead-day";
import type { Profile } from "@/types/domain";

/**
 * The home screens of the two operations roles, the crew and the project
 * lead, drawn from the same parts: a storm route when one is running, then
 * the crew's day with the job sheet on the same screen. The lead's adds
 * their crew under their own day.
 */
export async function OperationsHome({ profile, lead }: { profile: Profile; lead: boolean }) {
  const storm = await StormDay({ profile });
  return (
    <div className="-mx-4 sm:mx-0">
      {storm}
      <CrewDay
        profile={profile}
        inline
        nothingToday={(ctx) => <NothingToday ctx={ctx} storm={Boolean(storm)} />}
        sheets={(ctx) => <Sheets ctx={ctx} report={!lead} />}
        lead={
          lead
            ? (ctx) => (
                <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border bg-card/40" aria-busy="true" />}>
                  <LeadCrew profile={profile} ctx={ctx} />
                </Suspense>
              )
            : undefined
        }
      />
    </div>
  );
}

/** A storm on: the snow route, inline, above everything else. Nothing at all the rest of the year. */
async function StormDay({ profile }: { profile: Profile }) {
  if (!canRunJobs(profile.roles) && !hasRole(profile.roles, "project-technician")) return null;
  const route = await getActiveSnowRoute(await createClient()).catch(() => null);
  if (!route) return null;
  return (
    <div className="mx-auto max-w-md px-4 pt-4">
      <section data-tour="crew-storm" className="rounded-2xl border-2 border-sky-500/60 bg-sky-50/60 p-3 dark:bg-sky-500/10">
        <p className="mb-2 flex items-center gap-2 px-1 text-base font-bold">
          <Snowflake className="h-5 w-5 text-sky-600" /> Storm day: log every stop
        </p>
        <SnowStopLogger event={{ id: route.event.id, label: route.event.label }} stops={route.stops} defaultService={route.event.service} />
      </section>
    </div>
  );
}

/** Nothing booked today: say so, and show the next day they are booked. */
function NothingToday({ ctx, storm }: { ctx: CrewDayContext; storm: boolean }) {
  const { day } = ctx;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-white/60 bg-card/80 p-5 shadow-sm backdrop-blur-md">
        <CalendarClock className="h-8 w-8 text-primary" />
        <h2 className="mt-2 text-2xl font-bold">{storm ? "No other jobs today" : "Nothing scheduled today"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {storm
            ? "Work the snow route above."
            : day.nextProject
              ? "Here's your next day."
              : "Nothing booked for the next four weeks yet. When the office puts you on a job, it shows up here."}
        </p>
      </section>
      <NextUpCard today={day.day} visit={day.nextProject} existing={day.earlyStart} stops={day.stops} events={day.events} />
    </div>
  );
}

/** Today's job sheets: the area-by-area work, the photos, and a way to say something is wrong. */
function Sheets({ ctx, report }: { ctx: CrewDayContext; report: boolean }) {
  const { day } = ctx;
  const state = readDay(day.events, day.stops);
  const done = new Set(state.stopsDone);
  const openId = (state.currentStop ?? state.nextStop)?.jobId ?? null;
  return (
    <StopSheets
      key={openId ?? "none"}
      openId={openId}
      items={day.stops.map((stop) => ({
        jobId: stop.jobId,
        title: stop.customerName,
        sub: stop.address,
        done: done.has(stop.jobId),
        sheet: (
          <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-muted" aria-busy="true" />}>
            <StopSheet jobId={stop.jobId} sessionId={stop.sessionId} report={report} />
          </Suspense>
        ),
      }))}
    />
  );
}

async function StopSheet({ jobId, sessionId, report }: { jobId: string; sessionId: string; report: boolean }) {
  const sheet = await getWorkOrderForJob(jobId).catch(() => null);
  if (!sheet) return <p className="text-sm text-muted-foreground">Couldn&apos;t load this job&apos;s sheet. Try again in a minute.</p>;
  return (
    <div className="flex flex-col gap-4">
      <WorkOrderView jobId={jobId} {...sheet} crew inline />
      {report && (
        <section className="grid gap-2 border-t pt-3">
          <h3 className="text-sm font-semibold">Something wrong here?</h3>
          <ReportException jobId={jobId} workSessionId={sessionId} />
        </section>
      )}
    </div>
  );
}

const TONE: Record<CrewTone, string> = {
  late: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  moving: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100",
  here: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
  done: "bg-muted text-muted-foreground",
};

/** The lead's crew and jobs today: who's here, hours left, materials, issues, close-out. */
async function LeadCrew({ profile, ctx }: { profile: Profile; ctx: CrewDayContext }) {
  if (ctx.day.stops.length === 0) return null;
  const lead = await getLeadDay(profile, ctx);
  const card = "rounded-2xl border border-white/60 bg-card/80 p-4 shadow-sm backdrop-blur-md";
  const heading = "mb-2 flex items-center gap-2 text-sm font-bold";
  return (
    <div className="flex flex-col gap-4">
      {/* Who's where changes by the minute; the lead shouldn't have to pull to see it. */}
      <AutoRefresh seconds={120} />
      <section className={card} data-tour="lead-crew">
        <h2 className={heading}>
          <Users className="h-4 w-4" /> Your crew today
        </h2>
        {lead.crew.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody else is on your jobs today.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lead.crew.map((p) => (
              <li key={p.profileId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE[p.status.tone]}`}>{p.status.label}</span>
                </span>
                {p.phone && (
                  <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border">
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} data-tour="lead-budget">
        <h2 className={heading}>
          <Clock className="h-4 w-4" /> Hours left on budget
        </h2>
        <div className="grid gap-3">
          {lead.jobs.map((j) =>
            j.budget ? (
              <BudgetBar key={j.jobId} meter={j.budget} label={j.customerName} />
            ) : (
              <p key={j.jobId} className="text-sm text-muted-foreground">
                {j.customerName}: no hours budgeted.
              </p>
            )
          )}
        </div>
      </section>

      <section className={card} data-tour="lead-materials">
        <h2 className={heading}>
          <Package className="h-4 w-4" /> Materials
        </h2>
        {lead.materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No materials to bring today.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lead.materials.map((m) => (
              <li key={m.key} className="flex items-start gap-2 text-sm">
                {m.checked ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-amber-500" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.checked ? "On the truck" : "Not ticked as loaded"} · for {m.forStops.join(", ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Short of something? Raise it below on that job.</p>
      </section>

      <section className={card} data-tour="lead-issues">
        <h2 className={heading}>
          <AlertTriangle className="h-4 w-4" /> Issues
        </h2>
        <div className="flex flex-col gap-4">
          {lead.jobs.map((j) => (
            <div key={j.jobId} className="grid gap-2">
              <p className="font-semibold">{j.customerName}</p>
              {j.issues.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {j.issues.map((x) => (
                    <li key={x.id} className="rounded-lg border bg-background/60 px-3 py-2 text-sm">
                      <span className="font-medium">{x.label}</span>
                      {x.blocksWork && <span className="ml-1 text-xs font-semibold text-destructive">· stops work</span>}
                      <span className="block text-muted-foreground">{x.summary}</span>
                      <span className="block text-xs text-muted-foreground">{x.acknowledged ? "The office has seen it" : "Waiting for the office"}</span>
                    </li>
                  ))}
                </ul>
              )}
              <ReportException jobId={j.jobId} workSessionId={j.sessionId} />
            </div>
          ))}
        </div>
      </section>

      <section className={card} data-tour="lead-closeout">
        <h2 className={heading}>
          <Check className="h-4 w-4" /> Final walkthrough and close-out
        </h2>
        <div className="flex flex-col gap-3">
          {lead.jobs.map((j) => (
            <CloseOutCard key={j.jobId} jobId={j.jobId} customerName={j.customerName} walk={j.walk} canAskWalk={j.canAskWalk} completed={j.completed} />
          ))}
        </div>
      </section>
    </div>
  );
}
