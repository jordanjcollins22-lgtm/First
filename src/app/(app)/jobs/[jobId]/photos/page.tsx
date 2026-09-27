import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { listJobPhotos } from "@/lib/data/job-photos";
import { beforeAfterPairs } from "@/lib/project-closeout";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import type { WorkZone } from "@/components/canvas/types";

const STAGES = [
  { kind: "before", label: "Before" },
  { kind: "during", label: "During" },
  { kind: "after", label: "After" },
] as const;

/**
 * Progress photos: the befores, the durings and the afters, area by area,
 * with each area's before and after side by side at the top. Taken on the
 * crew sheet; looked at here.
 */
export default async function ProjectPhotosPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();
  const [{ data: job }, design, photos] = await Promise.all([
    supabase.from("jobs").select("id, name, property:properties(address)").eq("id", jobId).maybeSingle(),
    getCanvasDesignForJob(jobId),
    listJobPhotos(jobId).catch(() => []),
  ]);
  if (!job) notFound();
  const address = (job as unknown as { property: { address: string } | null }).property?.address ?? job.name;

  const zones = design ? ((design.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service).map((z) => ({ id: z.id, name: z.name })) : [];
  const pairs = beforeAfterPairs(
    photos.map((p) => ({ kind: p.kind, zoneId: p.zone_id, zoneName: p.zone_name, url: p.url, createdAt: p.created_at })),
    zones
  ).filter((pair) => pair.before && pair.after);

  // Areas in map order, then anything photographed against an area that has
  // since gone, then the job as a whole.
  const groups = [
    ...zones.map((z) => ({ key: z.id, name: z.name, photos: photos.filter((p) => p.zone_id === z.id) })),
    ...[...new Set(photos.filter((p) => p.zone_id && !zones.some((z) => z.id === p.zone_id)).map((p) => p.zone_id!))].map((id) => ({
      key: id,
      name: photos.find((p) => p.zone_id === id)?.zone_name ?? "Removed area",
      photos: photos.filter((p) => p.zone_id === id),
    })),
    { key: "whole", name: "Whole job", photos: photos.filter((p) => !p.zone_id) },
  ].filter((g) => g.photos.some((p) => p.kind !== "issue"));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <Link href={`/jobs/${jobId}`} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to the project
      </Link>
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress photos</p>
        <h1 className="text-xl font-bold leading-snug">{address}</h1>
        <p className="text-sm text-muted-foreground">
          {photos.filter((p) => p.kind !== "issue").length} photos. Taken on the{" "}
          <Link href={`/jobs/${jobId}/work-order`} className="text-primary hover:underline">
            crew sheet
          </Link>
          .
        </p>
      </header>

      {pairs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Before & after</h2>
          {pairs.map((pair) => (
            <div key={pair.zoneId} className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{pair.zoneName}</p>
              <div className="grid grid-cols-2 gap-2">
                {(["before", "after"] as const).map((side) => (
                  <figure key={side} className="flex flex-col gap-1">
                    {/* Signed storage URLs, which next/image cannot optimise. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pair[side]!} alt={`${pair.zoneName}, ${side}`} className="aspect-[4/3] w-full rounded-lg border border-border object-cover" />
                    <figcaption className="text-xs uppercase tracking-wide text-muted-foreground">{side}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm">No progress photos yet.</p>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">By area</h2>
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
              <p className="font-medium">{group.name}</p>
              {STAGES.map((stage) => {
                const shots = group.photos.filter((p) => p.kind === stage.kind && p.url);
                if (shots.length === 0) return null;
                return (
                  <div key={stage.kind} className="flex flex-col gap-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {stage.label} · {shots.length}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {shots.map((shot) => (
                        <a key={shot.id} href={shot.url!} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={shot.url!} alt={`${group.name}, ${stage.label}`} className="aspect-square w-full rounded-md border border-border object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
