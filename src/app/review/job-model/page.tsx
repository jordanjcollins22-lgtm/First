import { notFound } from "next/navigation";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { JobModelView } from "@/components/job-model/job-model-view";
import { SAMPLE_ADDRESS, SAMPLE_AREAS, SAMPLE_HOUSE, SAMPLE_JOB_ID, SAMPLE_MODEL, SAMPLE_PHOTOS, SAMPLE_TRUCK } from "@/lib/job-model-sample";

/** The 3D job model on a sample job, for reviewing from the Flow Board. Saves nothing. */
export const dynamic = "force-dynamic";

export default function ReviewJobModelPage() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">3D job model · sample</p>
        <h1 className="text-xl font-bold leading-snug">{SAMPLE_ADDRESS}</h1>
      </header>
      <JobModelView
        jobId={SAMPLE_JOB_ID}
        areas={SAMPLE_AREAS}
        house={SAMPLE_HOUSE}
        pin={SAMPLE_TRUCK}
        defaultTruck={SAMPLE_TRUCK}
        stored={SAMPLE_MODEL}
        canSave={false}
        saveNote="Sample job: changes aren't saved."
        canEdit
        photos={SAMPLE_PHOTOS.map((p) => ({ url: p.url, areaId: p.areaId }))}
      />
    </div>
  );
}
