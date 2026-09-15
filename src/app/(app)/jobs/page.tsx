import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listBoardJobs } from "@/lib/data/job-board";
import { jobsInView, sortForView, type BoardJob } from "@/lib/job-board";
import { jobStanding } from "@/lib/data/job-readiness";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell } from "@/components/module-shell";
import { JobBoardList } from "@/components/jobs/job-board-list";

/**
 * The work we sold, and where each piece of it is.
 *
 * There was no list of jobs before this -- only the pipeline, which stops at
 * the sale, and a job page you could reach if you already knew which job you
 * wanted. This is the operational half: what is coming, what is happening,
 * what is done.
 */
export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab } = await searchParams;

  const { allowed } = await checkTabAccess("job-detail");
  if (!allowed) redirect("/my-day");

  const jobs = await listBoardJobs().catch(() => []);
  // Both computed, never stored: Ready is the pre-start checks passing, and
  // Needs attention is the open blocking issues. Ask again after somebody
  // confirms the mulch and a job moves on its own.
  const standing = await jobStanding(jobs).catch(() => null);

  const upcoming = jobsInView(jobs, "upcoming");
  const ready: BoardJob[] = standing ? upcoming.filter((job) => standing.ready.has(job.id)) : [];
  // A job stays Upcoming or Active *and* appears here: "this has a material
  // problem" and "this is next Tuesday" are both true.
  const attention: BoardJob[] = standing
    ? sortForView(jobs.filter((job) => standing.attention.has(job.id)), "upcoming")
    : [];

  return (
    <ModuleShell
      module="jobs"
      asked={tab}
      content={{
        upcoming: <JobBoardList jobs={upcoming} view="upcoming" waiting={standing?.line} />,
        ready: (
          <JobBoardList
            jobs={ready}
            view="upcoming"
            empty="Nothing is ready to start. Open a job to see which check is failing."
          />
        ),
        active: <JobBoardList jobs={jobsInView(jobs, "active")} view="active" />,
        attention: (
          <JobBoardList
            jobs={attention}
            view="upcoming"
            waiting={
              standing
                ? new Map([...standing.why].map(([id, reasons]) => [id, reasons.map((r) => r.says).join(" · ")]))
                : undefined
            }
            empty="Nothing is stuck. No blocking issues, and nothing overdue."
          />
        ),
        completed: <JobBoardList jobs={jobsInView(jobs, "completed")} view="completed" />,
      }}
    />
  );
}
