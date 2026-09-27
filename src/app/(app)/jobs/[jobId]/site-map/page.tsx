import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCurrentProfile } from "@/lib/data/team";
import { visibilityFor } from "@/lib/roles";
import { allMaterialLineItems, costJob, costZone, formatMaterialQuantity } from "@/lib/proposal-pricing";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { serviceLabelFor } from "@/lib/zone-scope";
import { zonesBounds } from "@/lib/work-order";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import { FocusableSiteMap } from "@/components/proposal/focusable-site-map";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import type { WorkZone } from "@/components/canvas/types";

/**
 * The site map, read only: everything getting done on the project and
 * everything it needs.
 *
 * Not the crew sheet. This says what each area gets, how big it is, what
 * materials it takes and what it costs. How the crew go about it and what
 * they bring is on the crew sheet. Drawing and changing the map happens in
 * the evaluation tool; this is the finished map to look at.
 */
export default async function SiteMapPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();
  const [{ data: job }, catalog, design, viewer] = await Promise.all([
    supabase.from("jobs").select("id, name, property:properties(address)").eq("id", jobId).maybeSingle(),
    getCanvasCatalog(),
    getCanvasDesignForJob(jobId),
    getCurrentProfile(),
  ]);
  if (!job) notFound();
  const address = (job as unknown as { property: { address: string } | null }).property?.address ?? job.name;
  const money = visibilityFor(viewer?.roles ?? []).jobMoney;

  const zones = design ? ((design.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service) : [];
  const pricing = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));
  const materials = allMaterialLineItems(zones, catalog);
  const total = costJob(zones, catalog);
  const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const rows = zones.map((zone, i) => {
    const def = serviceTypeById(zone.service!.typeId);
    const cost = costZone(zone, catalog);
    const answers = (def?.fields ?? [])
      .filter((field) => zone.service?.values[field.key])
      .map((field) => ({ label: field.label, value: zone.service!.values[field.key] }));
    const size =
      zone.lengthFt != null && zone.widthFt != null
        ? `${zone.lengthFt} × ${zone.widthFt} ft`
        : zone.areaSqFt != null
          ? `${Math.round(zone.areaSqFt).toLocaleString()} sq ft`
          : null;
    return {
      zone,
      number: i + 1,
      service: serviceLabelFor(def, pricing.get(zone.service!.typeId) ? { name: pricing.get(zone.service!.typeId)!.name } : undefined),
      size,
      answers,
      notes: zone.service?.notes ?? "",
      materials: materials.filter((m) => m.zoneName === zone.name),
      priceCents: cost.priceCents,
    };
  });

  const materialsCents = total.materialsCents;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <Link href={`/jobs/${jobId}`} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to the project
      </Link>
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Site map</p>
        <h1 className="text-xl font-bold leading-snug">{address}</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} area{rows.length === 1 ? "" : "s"}
          {money && rows.length > 0 && ` · ${dollars(total.priceCents)} before travel and discounts`}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm dark:bg-amber-950/30">
          No site map yet. It is drawn on the evaluation.
        </p>
      ) : (
        <>
          {design?.image_path && (
            <FocusableSiteMap
              imagePath={design.image_path}
              transform={{
                x: design.image_x,
                y: design.image_y,
                scale: design.image_scale,
                rotation: design.image_rotation,
                canvasWidth: CANVAS_WIDTH,
                canvasHeight: CANVAS_HEIGHT,
              }}
              numbered
              dimSurroundings
              defaultFrame={zonesBounds(zones, CANVAS_WIDTH, CANVAS_HEIGHT)}
              className="w-full rounded-xl border border-border bg-muted"
              zones={zones.map((zone, i) => ({ zoneName: zone.name, color: zone.color, points: zone.points, number: i + 1 }))}
            />
          )}

          <ol className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.zone.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: row.zone.color }}
                  >
                    {row.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{row.zone.name}</p>
                    <p className="text-sm text-primary">
                      {row.service}
                      {row.size && <span className="text-muted-foreground"> · {row.size}</span>}
                    </p>
                  </div>
                  {money && <p className="shrink-0 font-semibold tabular-nums">{dollars(row.priceCents)}</p>}
                </div>

                {row.answers.length > 0 && (
                  <dl className="mt-2 flex flex-col gap-1 text-sm">
                    {row.answers.map((a) => (
                      <div key={a.label} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{a.label}</dt>
                        <dd className="text-right font-medium">{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {row.notes && <p className="mt-2 rounded-lg bg-muted/60 p-2 text-sm">{row.notes}</p>}

                {row.materials.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials</p>
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      {row.materials.map((m) => (
                        <li key={`${m.materialId}:${m.unit}`} className="flex justify-between gap-3">
                          <span>{m.material}</span>
                          <span className="text-right text-muted-foreground">
                            {money ? formatMaterialQuantity(m) : formatMaterialQuantity({ ...m, totalCost: null })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {money && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-xl border border-border bg-card p-4 text-sm">
              <dt className="text-muted-foreground">Materials, our cost</dt>
              <dd className="text-right tabular-nums">{dollars(materialsCents)}</dd>
              <dt className="text-muted-foreground">Labour, our cost</dt>
              <dd className="text-right tabular-nums">{dollars(total.labourCents)}</dd>
              <dt className="border-t border-border pt-1 font-semibold">Price, before travel and discounts</dt>
              <dd className="border-t border-border pt-1 text-right font-semibold tabular-nums">{dollars(total.priceCents)}</dd>
            </dl>
          )}
        </>
      )}
    </div>
  );
}
