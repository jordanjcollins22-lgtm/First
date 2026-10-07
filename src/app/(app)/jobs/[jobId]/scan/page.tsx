import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";
import { scanFolder, scanFramePath, type ScanManifest } from "@/lib/scan-frames";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PropertyScanUpload } from "@/components/scan/property-scan-upload";

/**
 * A 3D scan of the property from a walk-around video (demo): upload the
 * video, the phone takes the stills from it, and the stills are kept with
 * the job for building the model and a top-down plan.
 */
export const dynamic = "force-dynamic";

export default async function PropertyScanPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);
  const supabase = await createClient();
  const [{ data: job }, profile] = await Promise.all([
    supabase.from("jobs").select("id, name, property:properties(address)").eq("id", jobId).maybeSingle(),
    getCurrentProfile().catch(() => null),
  ]);
  if (!job) notFound();
  const address = (job as unknown as { property: { address: string } | null }).property?.address ?? job.name;

  // Each scan is a folder of stills with a manifest beside them.
  const storage = supabase.storage.from("canvas-images");
  const { data: folders } = await storage.list(`${jobId}/scans`, { limit: 50, sortBy: { column: "name", order: "desc" } });
  const scans = (
    await Promise.all(
      (folders ?? []).map(async (f) => {
        const { data } = await storage.download(`${scanFolder(jobId, f.name)}/manifest.json`);
        if (!data) return null;
        try {
          const m = JSON.parse(await data.text()) as ScanManifest;
          return { id: f.name, frames: m.frames, uploadedAt: m.uploadedAt, firstFrameUrl: canvasImageUrl(scanFramePath(jobId, f.name, 0), THUMBNAIL) };
        } catch {
          return null;
        }
      })
    )
  ).filter((s): s is NonNullable<typeof s> => s != null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <Link href={`/jobs/${jobId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to the job
      </Link>
      <header>
        <h1 className="text-xl font-bold">3D scan of the property</h1>
        <p className="text-sm text-muted-foreground">{address} · Demo</p>
      </header>
      <PropertyScanUpload jobId={jobId} uploadedBy={profile?.full_name ?? profile?.email ?? null} scans={scans} />
    </div>
  );
}
