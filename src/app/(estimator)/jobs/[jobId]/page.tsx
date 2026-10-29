import { notFound } from "next/navigation";

import { getJobWorkspace } from "@/lib/data/jobs";
import { getPreEvalForJob } from "@/lib/data/pre-evals";
import { listServiceTemplates } from "@/lib/data/service-templates";
import { JobWorkspaceClient as JobWorkspace } from "@/components/map/job-workspace-loader";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { isSupabaseConfigured } from "@/lib/env";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { jobId } = await params;
  const [workspace, serviceTemplates, preEval] = await Promise.all([
    getJobWorkspace(jobId),
    listServiceTemplates(),
    getPreEvalForJob(jobId),
  ]);

  if (!workspace) notFound();

  return (
    <JobWorkspace
      job={workspace.job}
      zones={workspace.zones}
      workAreas={workspace.workAreas}
      serviceTemplates={serviceTemplates}
      preEval={preEval}
    />
  );
}
