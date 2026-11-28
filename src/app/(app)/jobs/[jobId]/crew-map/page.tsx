import { notFound, redirect } from "next/navigation";

import { CrewMapEditor } from "@/components/phone/crew-map-editor";
import { isAccountManager } from "@/lib/affiliate-roles";
import { crewPath } from "@/lib/crew-link";
import { loadCrewJob } from "@/lib/data/crew-job";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Redo a job's crew map: tap the parts of the yard the crew works on (front,
 * sides, back, beds along the house) on the county lot. For jobs with no
 * drawn site map. Account manager and up only.
 */
export default async function CrewMapPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/jobs/${jobId}/crew-map`);
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) redirect(`/jobs/${jobId}`);
  const job = await loadCrewJob(jobId);
  if (!job) notFound();
  const lot = job.lat != null && job.lng != null ? await fetchLotFromCounty(job.lat, job.lng, job.address).catch(() => null) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-16 pt-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Crew map</p>
        <h1 className="text-2xl font-bold leading-tight">{job.clientName || "Client"}</h1>
        <p className="text-sm text-muted-foreground">{job.address}</p>
        <p className="text-sm">Tap the parts of the yard the crew works on. If the front is on the wrong side, tap &quot;Front&apos;s wrong?&quot; first.</p>
      </header>
      {lot ? (
        <CrewMapEditor jobId={jobId} lot={lot} start={job.crewMap} crewLink={crewPath(jobId)} />
      ) : (
        <p className="text-sm">The county property line for this address couldn&apos;t load, so there&apos;s nothing to tap. Try again in a minute.</p>
      )}
    </main>
  );
}
