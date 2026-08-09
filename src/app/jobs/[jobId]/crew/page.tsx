import { notFound } from "next/navigation";

import { getJobWorkspace } from "@/lib/data/jobs";
import { listServiceTemplates } from "@/lib/data/service-templates";
import { CrewPreview } from "@/components/crew/crew-preview";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { isSupabaseConfigured } from "@/lib/env";

export default async function CrewPreviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { jobId } = await params;
  const [workspace, serviceTemplates] = await Promise.all([
    getJobWorkspace(jobId),
    listServiceTemplates(),
  ]);

  if (!workspace) notFound();

  return (
    <CrewPreview
      job={workspace.job}
      zones={workspace.zones}
      workAreas={workspace.workAreas}
      serviceTemplates={serviceTemplates}
    />
  );
}
