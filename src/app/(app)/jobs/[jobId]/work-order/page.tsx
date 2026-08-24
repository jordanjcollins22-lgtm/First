import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { WorkOrderView } from "@/components/job/work-order-view";

/**
 * The crew sheet, at its own address.
 *
 * It already existed — a crew member opening a job gets it instead of the
 * office's view. What it did not have was a URL anybody else could visit, so
 * the only way to check what the crew would be looking at was to hold a crew
 * account. This is that URL, rendering the identical component from the
 * identical loader.
 *
 * Guarded by requireJobAccess rather than a tab: it is a view of one job, and
 * anybody who can open that job can see the work in it.
 */
export default async function WorkOrderPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;

  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const data = await getWorkOrderForJob(jobId);
  if (!data) notFound();

  return <WorkOrderView jobId={jobId} {...data} back={{ href: `/jobs/${jobId}`, label: "Back to the job" }} />;
}
