import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getAppFigures, getBusinessVariables, getPriceSources, getPricingEstimate, startingAreas } from "@/lib/data/business-variables";
import { travelForProperty } from "@/lib/data/job-travel";
import { createClient } from "@/lib/supabase/server";
import { NO_APP_FIGURES, type ProjectInput } from "@/lib/pricing-report";
import { canSeeJobMoney } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PricingEstimateEditor } from "@/components/pricing/pricing-estimate-editor";
import type { WorkZone } from "@/components/canvas/types";

/**
 * One job's pricing report: the office fills in each area's measurements,
 * tasks and conditions (Claude suggests them from the photos, the office
 * confirms), and the one-page report beside it is what is printed for
 * ordering and scheduling once the job is signed.
 */
export const dynamic = "force-dynamic";

const PHOTO_URL_SECONDS = 60 * 60;

export default async function PricingReportPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!canSeeJobMoney(profile.roles) && !profile.roles.includes("admin")) redirect(`/jobs/${jobId}`);

  const supabase = await createClient();
  const [{ data: job }, { data: design }, { data: photos }, { data: intake }, stored] = await Promise.all([
    supabase.from("jobs").select("id, name, property:properties(address, lat, lng, customer:customers(name))").eq("id", jobId).maybeSingle(),
    supabase.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_photos").select("path, zone_id").eq("job_id", jobId),
    supabase.from("evaluation_intakes").select("answers").eq("job_id", jobId).maybeSingle(),
    getBusinessVariables(supabase, profile.organization_id),
  ]);
  if (!job) notFound();
  const property = (job as unknown as { property: { address: string | null; lat: number | null; lng: number | null; customer: { name: string | null } | null } | null }).property;

  const [app, sources, travel] = await Promise.all([
    getAppFigures(supabase, profile.organization_id, stored.variables).catch(() => NO_APP_FIGURES),
    getPriceSources(supabase, profile.organization_id).catch(() => ({ supplierProducts: [], inventory: [] })),
    travelForProperty(supabase, profile.organization_id, property?.lat != null && property?.lng != null ? { lat: property.lat, lng: property.lng } : null).catch(() => null),
  ]);

  const byZone = new Map<string, string[]>();
  for (const p of (photos ?? []) as { path: string; zone_id: string | null }[]) {
    if (!p.zone_id) continue;
    byZone.set(p.zone_id, [...(byZone.get(p.zone_id) ?? []), p.path]);
  }
  const zones = ((design?.zones ?? []) as unknown as WorkZone[]) ?? [];
  const fallback: ProjectInput = {
    name: job.name,
    client: property?.customer?.name ?? null,
    address: property?.address ?? null,
    areas: startingAreas(zones, byZone, intake?.answers ?? null),
    crew: { leads: stored.variables.crew.leads, techs: stored.variables.crew.techs },
    driveMinutesEachWay: travel?.toSiteMinutes ?? null,
    disposalTrips: 0,
  };
  const estimate = await getPricingEstimate(supabase, profile.organization_id, jobId, fallback);
  // Name, client and address always come from the job, so a rename shows.
  const input: ProjectInput = { ...estimate.input, name: fallback.name, client: fallback.client, address: fallback.address };

  const paths = [...new Set(input.areas.flatMap((a) => a.photos ?? []))];
  const photoUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(paths, PHOTO_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
  }

  return (
    <PricingEstimateEditor
      jobId={jobId}
      initial={input}
      saved={estimate.saved}
      canSave={estimate.canSave}
      variables={stored.variables}
      sources={sources}
      app={app}
      photoUrls={photoUrls}
      driveFromMap={travel?.toSiteMinutes ?? null}
    />
  );
}
