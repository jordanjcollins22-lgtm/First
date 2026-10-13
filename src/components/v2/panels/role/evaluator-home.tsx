import { Suspense } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Clock, FileCheck2, FileQuestion, Phone } from "lucide-react";

import { getCurrentProfile } from "@/lib/data/team";
import { getEvaluatorDay, type Visit } from "@/lib/data/evaluator-day";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadScorecard } from "@/lib/data/sales-panels";
import { getCommissionFor } from "@/lib/data/commission";
import { personOpenTime } from "@/lib/data/open-time";
import { blockLabel, minutesLabel } from "@/lib/open-time";
import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import { latestChecks, proposalOutcome, readReasons, type OutcomeTone } from "@/lib/evaluator-home";
import { CLOSE_RATE_BAND } from "@/lib/sales/scorecard";
import { EvaluatorVisitButtons } from "@/components/v2/panels/role/evaluator-visit-buttons";
import { WeeklyAvailabilityEditor } from "@/components/evaluations/weekly-availability";
import { DaysOffEditor } from "@/components/team/days-off-editor";
import type { Profile, WeeklyAvailability } from "@/types/domain";
import { cn } from "@/lib/utils";

/**
 * The evaluator's home screen in the new layout, phone first, in the order
 * of their day: today's visits with Start visit on each, anything left
 * unfinished, what became of the proposals they submitted, what is coming
 * up, their hours, and their numbers.
 *
 * Loaded as the person shown (getCurrentProfile), so Preview as shows
 * exactly their day. The visit itself is the full-screen visit flow, opened
 * only from Start visit; it comes back here when it is done.
 */
export async function EvaluatorHomePanel() {
  const viewer = await getCurrentProfile();
  if (!viewer) return <Empty>Sign in to see your visits.</Empty>;
  const day = await getEvaluatorDay().catch(() => null);
  if (!day) return <Empty>Couldn&apos;t load your visits. Try again in a moment.</Empty>;
  const { today, upcoming, toWriteUp, timeZone } = day;
  const left = today.filter((v) => v.stage !== "submitted").length;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-7">
      <section data-tour="eval-today" className="grid gap-3">
        <SectionHead
          title={`Today · ${dayLabel(new Date().toISOString(), timeZone)}`}
          sub={today.length === 0 ? "No visits today." : left === 0 ? "All of today's visits are submitted." : `${left} ${left === 1 ? "visit" : "visits"} to do, in order.`}
        />
        {today.length === 0 ? (
          <Empty>Nothing booked today. Your next visits are under Coming up.</Empty>
        ) : (
          today.map((v, i) => <TodayCard key={v.id} visit={v} timeZone={timeZone} tour={i === today.findIndex((x) => x.stage !== "submitted")} />)
        )}
      </section>

      {toWriteUp.length > 0 && (
        <section className="grid gap-3">
          <SectionHead title="Not finished" sub="You visited, and Submit evaluation was never pressed." />
          <ul className="grid gap-2">
            {toWriteUp.map((v) => (
              <li key={v.id} className="flex items-center gap-3 rounded-xl border border-amber-400/70 bg-amber-50/60 p-3 dark:bg-amber-950/30">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted-foreground">{dayLabel(v.evaluationDate, timeZone)}</p>
                  <p className="font-semibold">{v.clientName}</p>
                  <p className="truncate text-sm text-muted-foreground">{v.address}</p>
                </div>
                <Link href={`/evaluate/${v.id}?start=1`} className="flex min-h-12 shrink-0 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
                  Finish it
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-tour="eval-proposals" className="grid gap-3">
        <SectionHead title="Your proposals" sub="What happened after you pressed Submit, for the last two weeks." />
        <Suspense fallback={<Loading />}>
          <Proposals viewerId={viewer.id} timeZone={timeZone} />
        </Suspense>
      </section>

      <section data-tour="eval-upcoming" className="grid gap-3">
        <SectionHead title="Coming up" sub="The next three weeks." />
        {upcoming.length === 0 ? (
          <Empty>Nothing booked in the next three weeks.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {upcoming.map((v) => (
              <UpcomingRow key={v.id} visit={v} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </section>

      <section data-tour="eval-availability" className="grid gap-3">
        <SectionHead title="Your hours" sub="Visits are only booked when you're free." />
        <Suspense fallback={<Loading />}>
          <Hours viewer={viewer} timeZone={timeZone} />
        </Suspense>
      </section>

      <section data-tour="eval-numbers" className="grid gap-3">
        <SectionHead title="Your numbers" sub="The last 90 days." />
        <Suspense fallback={<Loading />}>
          <Numbers viewer={viewer} />
        </Suspense>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- today */

function TodayCard({ visit, timeZone, tour }: { visit: Visit; timeZone: string; tour: boolean }) {
  const done = visit.stage === "submitted";
  return (
    <article className={cn("grid gap-3 rounded-2xl border bg-card p-4 shadow-sm", done && "opacity-80")}>
      <div className="min-w-0">
        <p className="text-sm font-bold text-primary">{timeLabel(visit.evaluationDate, timeZone)}</p>
        <p className="text-xl font-extrabold leading-tight">{visit.clientName}</p>
        <p className="text-sm text-muted-foreground">{visit.address || "No address on file"}</p>
        <p className="mt-1.5">
          <FormChip sent={visit.formSent} />
        </p>
      </div>
      {done ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Submitted. See Your proposals below.
        </p>
      ) : (
        <EvaluatorVisitButtons jobId={visit.id} stage={visit.stage} phone={visit.phone} firstName={visit.clientName.split(/\s+/)[0] || "them"} tour={tour} />
      )}
    </article>
  );
}

function FormChip({ sent }: { sent: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        sent ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground"
      )}
    >
      {sent ? <FileCheck2 className="h-3 w-3" /> : <FileQuestion className="h-3 w-3" />}
      {sent ? "They filled out the questions" : "No answers yet: go through them on site"}
    </span>
  );
}

function UpcomingRow({ visit, timeZone }: { visit: Visit; timeZone: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted-foreground">
          {dayLabel(visit.evaluationDate, timeZone)} · {timeLabel(visit.evaluationDate, timeZone)}
        </p>
        <p className="font-semibold">{visit.clientName}</p>
        <p className="truncate text-sm text-muted-foreground">{visit.address}</p>
      </div>
      {visit.phone && (
        <a href={`tel:${visit.phone}`} aria-label={`Call ${visit.clientName}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border hover:bg-muted">
          <Phone className="h-5 w-5" />
        </a>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ proposals */

const TONE: Record<OutcomeTone, string> = {
  sent: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50",
  won: "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-50",
  held: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50",
  waiting: "bg-card",
  lost: "bg-muted/60 text-muted-foreground",
};

async function Proposals({ viewerId, timeZone }: { viewerId: string; timeZone: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, evaluation_date, evaluation_submitted_at, property:properties(address, customer:customers(name))")
    .eq("assigned_to", viewerId)
    .eq("evaluation_status", "completed")
    .gte("evaluation_date", daysAgo(14))
    .order("evaluation_date", { ascending: false })
    .limit(15);
  const jobs = (data ?? []) as unknown as {
    id: string;
    evaluation_date: string;
    evaluation_submitted_at: string | null;
    property: { address: string | null; customer: { name: string | null } | null } | null;
  }[];
  if (jobs.length === 0) return <Empty>Nothing submitted in the last two weeks.</Empty>;

  const ids = jobs.map((j) => j.id);
  const [{ data: proposals }, { data: checks }] = await Promise.all([
    supabase.from("job_proposals").select("job_id, status, sent_at, total_cost, discount_amount").in("job_id", ids),
    // Newer than the generated types.
    (supabase as unknown as SupabaseClient)
      .from("proposal_guardrail_checks")
      .select("job_id, action, reasons, checked_at")
      .in("job_id", ids),
  ]);
  const proposalOf = new Map(((proposals ?? []) as { job_id: string; status: string; sent_at: string | null; total_cost: number | null; discount_amount: number | null }[]).map((p) => [p.job_id, p]));
  const checkOf = latestChecks(((checks ?? []) as unknown as { job_id: string; action: string; reasons: unknown; checked_at: string }[]));

  return (
    <ul className="grid gap-2">
      {jobs.map((j) => {
        const p = proposalOf.get(j.id);
        const c = checkOf.get(j.id);
        const outcome = proposalOutcome({
          status: p?.status ?? null,
          sentAt: p?.sent_at ?? null,
          check: c ? { action: c.action, reasons: readReasons(c.reasons) } : null,
        });
        const total = p?.total_cost != null ? Math.max(0, Number(p.total_cost) - Number(p.discount_amount ?? 0)) : null;
        return (
          <li key={j.id} className={cn("grid gap-1 rounded-xl border p-3", TONE[outcome.tone])}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate font-semibold">{j.property?.customer?.name || "Client"}</p>
              {total != null && total > 0 && <p className="shrink-0 font-mono text-sm">{usd(total)}</p>}
            </div>
            <p className="text-sm font-semibold">{outcome.label}</p>
            {outcome.why && <p className="text-xs opacity-80">{outcome.why}</p>}
            <p className="truncate text-xs opacity-70">
              Visited {dayLabel(j.evaluation_date, timeZone)} · {j.property?.address ?? ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- hours */

async function Hours({ viewer, timeZone }: { viewer: Profile; timeZone: string }) {
  const supabase = await createClient();
  const today = dateKeyIn(new Date());
  const [open, { data: weekly }, { data: daysOff }] = await Promise.all([
    personOpenTime(supabase, { id: viewer.id, name: viewer.full_name || viewer.email, email: viewer.email }, today).catch(() => null),
    supabase.from("availability_weekly").select("*").eq("profile_id", viewer.id),
    supabase.from("availability_days_off").select("date, start_time, end_time, reason").eq("profile_id", viewer.id).gte("date", today).order("date"),
  ]);
  return (
    <div className="grid gap-4">
      {open && (
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center justify-between gap-2 font-semibold">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Free today
            </span>
            <span>{open.score.openMinutes > 0 ? minutesLabel(open.score.openMinutes) : "None"}</span>
          </p>
          {open.blocks.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {open.blocks.map((b) => (
                <li key={b.startsAt}>
                  {blockLabel(b, timeZone)} ({minutesLabel(b.minutes)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <WeeklyAvailabilityEditor myAvailability={(weekly ?? []) as unknown as WeeklyAvailability[]} />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <DaysOffEditor
          today={today}
          daysOff={((daysOff ?? []) as { date: string; start_time: string | null; end_time: string | null; reason: string | null }[]).map((d) => ({
            date: d.date,
            startTime: d.start_time?.slice(0, 5) ?? null,
            endTime: d.end_time?.slice(0, 5) ?? null,
            reason: d.reason,
          }))}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- numbers */

async function Numbers({ viewer }: { viewer: Profile }) {
  const organizationId = await getCurrentOrganizationId().catch(() => null);
  const [card, commission] = await Promise.all([
    organizationId ? loadScorecard(organizationId).catch(() => null) : Promise.resolve(null),
    getCommissionFor(viewer).catch(() => null),
  ]);
  const me = card?.rows.find((r) => r.evaluatorId === viewer.id) ?? null;
  const decided = me ? me.accepted + me.declined : 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile
        label="Close rate"
        value={me?.closeRate != null ? pct(me.closeRate) : "—"}
        note={me ? `${me.accepted} signed of ${decided} answered. Aim for ${pct(CLOSE_RATE_BAND.high)}.` : "Shows once clients answer your proposals."}
        strong
      />
      <Tile label="Visits" value={me ? String(me.shows) : "0"} note={me ? `${me.proposalsSent} proposals sent` : undefined} />
      <Tile label="Commission to be paid" value={commission ? usd(commission.earned) : "—"} note={commission ? `${commission.lines[0]?.pct ?? commission.pct}% of what clients pay` : undefined} strong />
      <Tile label="Still coming in" value={commission ? usd(commission.accruing) : "—"} note={commission ? `${usd(commission.paid)} paid to you so far` : undefined} />
    </div>
  );
}

function Tile({ label, value, note, strong = false }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", strong ? "border-primary/40 bg-primary/5" : "bg-card")}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-2xl font-bold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- bits */

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-xl font-extrabold">{title}</h2>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

function Loading() {
  return <div className="h-24 animate-pulse rounded-xl border bg-card/40" aria-busy="true" />;
}

const timeLabel = (at: string, timeZone: string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
const dayLabel = (at: string, timeZone: string) => new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
/** The moment a number of days back, for a query. */
function daysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
