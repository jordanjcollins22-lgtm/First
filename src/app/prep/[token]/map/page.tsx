import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordFunnelStep } from "@/lib/data/funnel-events";
import { isMapboxConfigured } from "@/lib/public-env";
import { estimatePath, getTapPreEval } from "@/lib/data/tap-estimate";
import { intakePath } from "@/lib/data/evaluation-intake";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { TapMapLoader } from "@/components/tap-pre-eval/tap-map-loader";

/**
 * The pre-evaluation as a map, straight after their details: tap where you
 * want work done, say what, add a photo, and the estimate comes next.
 */
export const dynamic = "force-dynamic";

/**
 * Sending the map reads each spot's satellite picture and photos to size it,
 * which can take up to its own 25 second deadline, plus the lot and the save.
 * Server actions take their time limit from the page, so this keeps that from
 * being cut off on a host whose default is shorter.
 */
export const maxDuration = 60;

export default async function TapMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ welcome?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const { welcome } = (await searchParams) ?? {};
  const data = await getTapPreEval(token);
  if (!data) notFound();
  // No map to tap on: the long form still works without one.
  if (!data.home || !isMapboxConfigured) redirect(intakePath(token));
  // Paid is final from here; changes go through a message.
  if (data.estimate?.paidAt) redirect(estimatePath(token));
  if (data.organizationId) {
    await recordFunnelStep(createAdminClient(), { organizationId: data.organizationId, step: "map_opened", jobId: data.intake.jobId });
  }


  return (
    <TapMapLoader
      token={token}
      home={data.home}
      lot={data.lot}
      initialSpots={data.estimate?.spots ?? []}
      photoUrls={data.photoUrls}
      firstName={welcome === "1" ? data.intake.clientFirstName : null}
      estimateHref={estimatePath(token)}
    />
  );
}
