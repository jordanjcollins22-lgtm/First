import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { isSupabaseConfigured } from "@/lib/env";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { jobId } = await params;
  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("*, property:properties(address, lat, lng)")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!jobRow) notFound();

  const job = jobRow as unknown as {
    id: string;
    name: string;
    property: { address: string; lat: number; lng: number } | null;
  };

  const [catalog, design] = await Promise.all([getCanvasCatalog(), getCanvasDesignForJob(jobId)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">{job.name}</h1>
        <p className="text-muted-foreground">
          Draw work zones and fill in the service details to build a scope of work for this job.
        </p>
      </div>

      <ImageCanvasBoard
        catalog={catalog}
        jobId={jobId}
        initialDesign={design}
        initialAddress={job.property?.address ?? ""}
        initialLat={job.property?.lat}
        initialLng={job.property?.lng}
      />
    </div>
  );
}
