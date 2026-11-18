import { notFound, redirect } from "next/navigation";

import { ClientFileView } from "@/components/phone/client-file-view";
import { customerOfJob, loadClientFile } from "@/lib/data/client-file";
import { getCurrentProfile } from "@/lib/data/team";

export const dynamic = "force-dynamic";

/** A job: its client's page with this job first. */
export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!(await getCurrentProfile())) redirect("/login");
  const { jobId } = await params;
  const customerId = await customerOfJob(jobId);
  const file = customerId ? await loadClientFile(customerId) : null;
  if (!file) notFound();
  return <ClientFileView file={file} jobId={jobId} />;
}
