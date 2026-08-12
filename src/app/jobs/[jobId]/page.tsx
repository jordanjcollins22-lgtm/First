import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { isSupabaseConfigured } from "@/lib/env";
import type { EvaluationStatus } from "@/types/domain";

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
    evaluation_status: EvaluationStatus;
    property: { address: string; lat: number; lng: number } | null;
  };

  const [catalog, design] = await Promise.all([getCanvasCatalog(), getCanvasDesignForJob(jobId)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <Link href="/attractors" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Project Data
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{job.property?.address ?? job.name}</h1>
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
        initialEvaluationStatus={job.evaluation_status}
      />
    </div>
  );
}
