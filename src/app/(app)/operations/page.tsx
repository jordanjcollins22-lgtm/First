import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell } from "@/components/module-shell";
import { Deferred } from "@/components/deferred";
import { CalendarTab, WeatherTab } from "@/app/(app)/evaluations/page";
import SaltPage from "@/app/(app)/admin/salt/page";
import { SuggestionsPanel } from "@/components/schedule/suggestions-panel";
import { EvaluationBuckets } from "@/components/sales/evaluation-buckets";
import { JobBoardList } from "@/components/jobs/job-board-list";
import { JobViews } from "@/components/jobs/job-views";
import { CrewLeaderboard } from "@/components/crew/crew-leaderboard";
import { scheduleSuggestions } from "@/lib/data/schedule-engine";
import { listSalesEvaluations } from "@/lib/data/sales-evaluations";
import { listBoardJobs } from "@/lib/data/job-board";
import { jobStanding } from "@/lib/data/job-readiness";
import { getCrewBoards } from "@/lib/data/crew-leaderboard";
import { getAllowedTabs } from "@/lib/data/access";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { isTheirs, jobsInView, needsScheduling, sortForView, type BoardJob } from "@/lib/job-board";
import { subtabsFor } from "@/lib/modules";
import { evaluatorOptions, roleViewFor } from "@/lib/affiliate-roles";
import { canRunJobs, isOwnerLevel } from "@/lib/roles";
import type { Profile } from "@/types/domain";

/**
 * Operations: when the work happens, and whether it is getting done.
 *
 * What was Schedule and Jobs, and the evaluations from Sales, in one place,
 * because they are one question asked at three distances: what is booked,
 * what is sold and waiting, and what is underway. Every subtab renders the
 * screen that already existed, at the permission it already had.
 *
 * An evaluator or an account manager sees their own: the evaluations and
 * jobs assigned to them or for the clients they manage, not the company's.
 */
export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab, view: jobView } = await searchParams;
  const [profile, allowed] = await Promise.all([getCurrentProfile(), getAllowedTabs()]);
  const roleView = roleViewFor(profile?.roles ?? []);
  // Only what this person will be shown is loaded: the county's job board is
  // not fetched for an evaluator who sees the calendar and their own list.
  const shown = new Set(subtabsFor("operations", [...allowed], roleView).map((s) => s.key));
  const onlyTheirs = roleView === "evaluator" || roleView === "account-manager";

  // Each tab loads alongside the others and arrives on its own, so the page
  // is not the sum of every tab's wait -- the weather service used to hold up
  // the calendar.
  const content: Record<string, React.ReactNode> = {};
  if (shown.has("calendar")) content.calendar = <Deferred load={() => CalendarTab({ section: "calendar" })} />;
  if (shown.has("evaluations")) content.evaluations = <Deferred load={() => EvaluationsTab({ profile, onlyTheirs })} />;
  if (shown.has("jobs")) content.jobs = <Deferred load={() => JobsTab({ profile, onlyTheirs, initial: jobView ?? null })} />;
  if (shown.has("crew")) content.crew = <Deferred load={() => CrewTab(profile)} />;
  if (shown.has("weather")) content.weather = <Deferred load={() => WeatherTab()} />;
  if (shown.has("booking")) content.booking = <Deferred load={() => CalendarTab({ section: "booking" })} />;
  if (shown.has("salt")) content.salt = <SaltPage />;
  if (shown.has("suggestions")) content.suggestions = <Deferred load={() => SuggestionsTab(profile)} />;

  return <ModuleShell module="operations" asked={tab} content={content} />;
}

/** Every evaluation, bucketed; only their own for an evaluator or account manager. */
async function EvaluationsTab({ profile, onlyTheirs }: { profile: Profile | null; onlyTheirs: boolean }) {
  const canReassign = Boolean(profile && canRunJobs(profile.roles));
  const [evaluations, team] = await Promise.all([
    listSalesEvaluations().catch(() => []),
    canReassign ? listProfiles().catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <EvaluationBuckets
      evaluations={onlyTheirs && profile ? evaluations.filter((e) => isTheirs(e, profile.id)) : evaluations}
      now={new Date().toISOString()}
      evaluators={canReassign ? evaluatorOptions(team, null) : undefined}
      canReassign={canReassign}
    />
  );
}

async function CrewTab(profile: Profile | null) {
  const boards = await getCrewBoards().catch((err) => {
    console.error("Crew leaderboard failed to load:", err);
    return { recent: [], allTime: [] };
  });
  return (
    <CrewLeaderboard
      boards={boards}
      meId={profile?.id ?? null}
      canOpenAll={Boolean(profile && (profile.roles.includes("admin") || profile.roles.includes("owner")))}
    />
  );
}

/** The job board: one list, five views as chips. */
async function JobsTab({ profile, onlyTheirs, initial }: { profile: Profile | null; onlyTheirs: boolean; initial: string | null }) {
  const all = await listBoardJobs().catch(() => []);
  const jobs = onlyTheirs && profile ? all.filter((job) => isTheirs(job, profile.id)) : all;
  // Both computed, never stored: Ready is the pre-start checks passing, and
  // Needs attention is the open blocking issues.
  const standing = await jobStanding(jobs).catch(() => null);

  const upcoming = jobsInView(jobs, "upcoming");
  const ready: BoardJob[] = standing ? upcoming.filter((job) => standing.ready.has(job.id)) : [];
  // A job stays Upcoming or Active *and* appears here: "this has a material
  // problem" and "this is next Tuesday" are both true.
  const attention: BoardJob[] = standing ? sortForView(jobs.filter((job) => standing.attention.has(job.id)), "upcoming") : [];
  const active = jobsInView(jobs, "active");
  const completed = jobsInView(jobs, "completed");
  // Signed and waiting on a date. First, and open by default while there are
  // any: a sold job nobody has booked is money sitting still.
  const toSchedule = upcoming.filter(needsScheduling);
  const canSchedule = Boolean(profile && canRunJobs(profile.roles));

  return (
    <JobViews
      initial={initial ?? (toSchedule.length > 0 ? "schedule" : null)}
      views={[
        {
          key: "schedule",
          label: "To schedule",
          count: toSchedule.length,
          blurb: "Signed, and no work day booked yet. Press Schedule to put it on the calendar.",
          content: (
            <JobBoardList
              jobs={toSchedule}
              view="upcoming"
              canSchedule={canSchedule}
              empty="Every signed job has a date."
            />
          ),
        },
        {
          key: "upcoming",
          label: "Upcoming",
          count: upcoming.length,
          blurb: "Sold work, scheduled or waiting to be.",
          content: <JobBoardList jobs={upcoming} view="upcoming" waiting={standing?.line} canSchedule={canSchedule} />,
        },
        {
          key: "ready",
          label: "Ready",
          count: ready.length,
          blurb: "Every pre-start check passing and nothing blocking. Safe to send a crew.",
          content: <JobBoardList jobs={ready} view="upcoming" empty="Nothing is ready to start. Open a job to see which check is failing." />,
        },
        {
          key: "active",
          label: "Active",
          count: active.length,
          blurb: "Being worked on now.",
          content: <JobBoardList jobs={active} view="active" />,
        },
        {
          key: "attention",
          label: "Needs attention",
          count: attention.length,
          blurb: "Something unresolved is stopping these, whatever else they are.",
          content: (
            <JobBoardList
              jobs={attention}
              view="upcoming"
              waiting={standing ? new Map([...standing.why].map(([id, reasons]) => [id, reasons.map((r) => r.says).join(" · ")])) : undefined}
              empty="Nothing is stuck. No blocking issues, and nothing overdue."
            />
          ),
        },
        {
          key: "completed",
          label: "Completed",
          count: completed.length,
          blurb: "Finished work.",
          content: <JobBoardList jobs={completed} view="completed" />,
        },
      ]}
    />
  );
}

/**
 * The engine's opinion, and nothing more than that.
 *
 * It fails on its own: a forecast that will not answer or a site plan that
 * will not read costs this subtab a caveat, not the calendar beside it.
 */
async function SuggestionsTab(viewer: Profile | null) {
  const output = await scheduleSuggestions().catch((err) => {
    console.error("Schedule suggestions failed to load:", err);
    return { enabled: false, suggestions: [], moves: [], caveats: [] };
  });
  const roles = (viewer?.roles ?? []) as string[];
  return (
    <SuggestionsPanel
      enabled={output.enabled}
      suggestions={output.suggestions}
      moves={output.moves}
      caveats={output.caveats}
      canAccept={canRunJobs(roles)}
      canToggle={isOwnerLevel(roles)}
    />
  );
}
