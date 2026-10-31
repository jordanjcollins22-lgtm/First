import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordFunnelStep } from "@/lib/data/funnel-events";
import { publicEnv } from "@/lib/public-env";
import { getTapPreEval, schedulePath, tapMapPath } from "@/lib/data/tap-estimate";
import { listExternalMessagesForJob } from "@/lib/data/public-job-messages";
import { fitView, type LngLat } from "@/lib/lot-map";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { EstimateView } from "@/components/tap-pre-eval/estimate-view";

/**
 * The estimate, straight after the map pre-evaluation: what they asked for,
 * what it comes to, and how they'd like to pay (a third down, or a paid
 * evaluation) before they pick a visit time.
 */
export const dynamic = "force-dynamic";

const MAP_WIDTH = 600;
const MAP_HEIGHT = 400;

/** A satellite picture of the property with each spot numbered on it. */
function spotsMapUrl(points: LngLat[], frame: LngLat[]): string | null {
  if (!publicEnv.mapboxToken || points.length === 0) return null;
  const { center, zoom } = fitView(frame, MAP_WIDTH, MAP_HEIGHT);
  const pins = points.map(([lng, lat], i) => `pin-l-${i + 1}+2f6d3c(${lng.toFixed(6)},${lat.toFixed(6)})`).join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${pins}/${center[0].toFixed(6)},${center[1].toFixed(6)},${zoom}/${MAP_WIDTH}x${MAP_HEIGHT}@2x?access_token=${publicEnv.mapboxToken}`;
}

export default async function EstimatePage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;

  const data = await getTapPreEval(token);
  if (!data) notFound();
  if (!data.estimate) redirect(tapMapPath(token));
  const estimate = data.estimate;
  if (data.organizationId) {
    await recordFunnelStep(createAdminClient(), { organizationId: data.organizationId, step: "estimate_viewed", jobId: data.intake.jobId });
  }

  const points = estimate.spots.map((s): LngLat => [s.lng, s.lat]);
  const frame = [...(data.lot?.ring ?? (data.home ? [data.home] : [])), ...points];
  const messages = await listExternalMessagesForJob(data.intake.jobId).catch(() => []);

  return (
    <EstimateView
      token={token}
      businessName={data.intake.businessName}
      businessPhone={data.intake.businessPhone}
      clientFirstName={data.intake.clientFirstName}
      address={data.intake.address}
      visit={data.intake.evaluationAt && !data.intake.cancelled ? `${dayOnly(data.intake.evaluationAt)} at ${timeOnly(data.intake.evaluationAt).toLowerCase()}` : null}
      estimate={estimate}
      mapUrl={spotsMapUrl(points, frame)}
      photoUrls={data.photoUrls}
      messages={messages.map((m) => ({ id: m.id, fromClient: m.author_type === "client", author: m.author_name, body: m.body, at: m.created_at }))}
      tiers={data.tiers}
      scheduleHref={schedulePath(token)}
      mapHref={tapMapPath(token)}
    />
  );
}
