import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listBoardJobs } from "@/lib/data/job-board";
import { jobsInView } from "@/lib/job-board";
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

  return (
    <ModuleShell
      module="jobs"
      asked={tab}
      content={{
        upcoming: <JobBoardList jobs={jobsInView(jobs, "upcoming")} view="upcoming" />,
        active: <JobBoardList jobs={jobsInView(jobs, "active")} view="active" />,
        completed: <JobBoardList jobs={jobsInView(jobs, "completed")} view="completed" />,
      }}
    />
  );
}
