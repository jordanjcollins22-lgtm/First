import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
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
