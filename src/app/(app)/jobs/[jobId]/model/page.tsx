import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { loadJobModel } from "@/lib/data/job-model";
import { getCurrentProfile } from "@/lib/data/team";
import { canRunJobs } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { JobModelView } from "@/components/job-model/job-model-view";

/**
 * The job in 3D: its beds on the satellite map, every plant kept, added or
 * coming out at its real size, and the work in numbered steps from the
 * truck. The office places and orders it; the crew open it before the job
 * and walk through it.
 */
export const dynamic = "force-dynamic";

export default async function JobModelPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);
  const [model, viewer] = await Promise.all([loadJobModel(jobId), getCurrentProfile()]);
  if (!model) notFound();
  const canEdit = canRunJobs(viewer?.roles ?? []);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4">
      <Link href={`/jobs/${jobId}`} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to the project
      </Link>
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">3D job model</p>
        <h1 className="text-xl font-bold leading-snug">{model.address}</h1>
      </header>
      {model.areas.length === 0 && (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/30">No beds yet: they come from the site map.</p>
      )}
      {model.unplacedAreas > 0 && (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/30">
          {model.unplacedAreas} area{model.unplacedAreas === 1 ? " is" : "s are"} drawn on an uploaded photo, so not on the map.
        </p>
      )}
      <JobModelView
        jobId={jobId}
        areas={model.areas}
        house={model.house}
        pin={model.pin}
        defaultTruck={model.defaultTruck}
        stored={model.stored}
        canSave={model.ready}
        saveNote={model.ready ? null : "Saving needs the database update (0372) first."}
        canEdit={canEdit}
        photos={model.photos.map((p) => ({ url: p.url, areaId: p.areaId }))}
      />
    </div>
  );
}
