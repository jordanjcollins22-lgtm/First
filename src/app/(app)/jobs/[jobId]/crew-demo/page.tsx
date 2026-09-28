import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { listKitContainers } from "@/lib/data/kit-containers";
import { getShopInfo } from "@/lib/data/shop-flow";
import { getCurrentProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { areaNeeds, pickKits, tipsFor, type AreaNeeds } from "@/lib/area-work";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CrewDemo } from "@/components/crew-demo/crew-demo";
import type { WorkZone } from "@/components/canvas/types";

/**
 * A real job's crew sheet as a demo: the crew's own screens, from the shop
 * to asking for the walkthrough, with this job's site map, photos and
 * scope, to click through. Every tap changes this screen only: nothing is
 * recorded, uploaded or sent, and the job is exactly as it was.
 */
export const dynamic = "force-dynamic";

export default async function CrewDemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  /** as: whose phone to see it from. Left out, the job's crew lead. */
  searchParams: Promise<{ as?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  const { as } = await searchParams;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();
  const [data, design, catalog, containers, shop, me, { data: place }, { data: crewRows }] = await Promise.all([
    getWorkOrderForJob(jobId),
    getCanvasDesignForJob(jobId),
    getCanvasCatalog(),
    listKitContainers().catch(() => []),
    getShopInfo().catch(() => null),
    getCurrentProfile().catch(() => null),
    supabase.from("jobs").select("property:properties(lat, lng)").eq("id", jobId).maybeSingle(),
    supabase.from("job_crew").select("profile_id, is_lead, profiles:profile_id(full_name, email)").eq("job_id", jobId),
  ]);
  if (!data) notFound();

  // Seen from one crew member's phone: the one asked for, or the job's lead.
  const crew = (crewRows ?? []) as unknown as { profile_id: string; is_lead: boolean; profiles: { full_name: string | null; email: string } | null }[];
  const viewer = crew.find((c) => c.profile_id === as) ?? crew.find((c) => c.is_lead) ?? crew[0] ?? null;
  const viewerName = viewer ? viewer.profiles?.full_name || viewer.profiles?.email || null : null;

  const workZones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const toolRefs = catalog.tools.map((t) => ({ id: t.id, name: t.name, kits: ((t as unknown as { kits?: number[] | null }).kits ?? []) as number[] }));
  const needs: Record<string, AreaNeeds> = Object.fromEntries(workZones.map((z) => [z.id, areaNeeds(z.service!.typeId, catalog.serviceTools, toolRefs)]));

  // What goes on the truck for this job: a kit for each tool that lives in
  // one, and the tools that travel loose.
  const kits = new Set<number>();
  for (const z of workZones) {
    const pick = pickKits(needs[z.id], new Set(kits), new Set());
    if (pick.ok) pick.kits.forEach((k) => kits.add(k));
  }
  const typeIds = new Set(workZones.map((z) => z.service!.typeId));
  const looseToolIds = [
    ...new Set(
      catalog.serviceTools
        .filter((link) => typeIds.has(link.service_type_id))
        .map((link) => toolRefs.find((t) => t.id === link.tool_id))
        .filter((t): t is (typeof toolRefs)[number] => Boolean(t) && t!.kits.length === 0)
        .map((t) => t.id)
    ),
  ];
  const property = (place as unknown as { property: { lat: number | null; lng: number | null } | null } | null)?.property;

  return (
    <CrewDemo
      jobId={jobId}
      personName={viewerName ?? me?.full_name ?? "Jordan"}
      viewingAs={viewerName}
      sheet={data}
      stop={{ jobId, sessionId: "demo", address: data.address, customerName: data.customerName, lat: property?.lat ?? null, lng: property?.lng ?? null, purpose: null }}
      zones={data.order.zones}
      boardZones={workZones.map((z) => ({ id: z.id, name: z.name, serviceTypeId: z.service!.typeId, values: z.service!.values }))}
      needs={needs}
      tips={Object.fromEntries(workZones.map((z) => [z.id, tipsFor(z.service!.typeId)]))}
      loadout={{
        kits: [...kits].sort((a, b) => a - b),
        toolIds: looseToolIds,
        tools: toolRefs,
        containers: containers.filter((c) => !c.archivedAt).map((c) => ({ name: c.name, kits: c.kits, code: c.code ?? null })),
      }}
      shop={shop}
      siteImagePath={data.siteImagePath}
      imageTransform={data.imageTransform}
      accountManager={data.accountManager}
    />
  );
}
