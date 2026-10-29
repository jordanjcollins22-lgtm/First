import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { isMapboxConfigured } from "@/lib/public-env";
import { estimatePath, getTapPreEval } from "@/lib/data/tap-estimate";
import { intakePath } from "@/lib/data/evaluation-intake";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { TapMapLoader } from "@/components/tap-pre-eval/tap-map-loader";

/**
 * The pre-evaluation as a map, straight after booking: tap where you want
 * work done, say what, add a photo, and the estimate comes next.
 */
export const dynamic = "force-dynamic";

export default async function TapMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ booked?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const { booked } = (await searchParams) ?? {};
  const data = await getTapPreEval(token);
  if (!data) notFound();
  // No map to tap on: the long form still works without one.
  if (!data.home || !isMapboxConfigured) redirect(intakePath(token));
  // Accepted is final from here; changes go through a message.
  if (data.estimate?.acceptedAt) redirect(estimatePath(token));

  const { intake } = data;
  const bookedFor =
    intake.evaluationAt && !intake.cancelled ? `${dayOnly(intake.evaluationAt)} at ${timeOnly(intake.evaluationAt).toLowerCase()}` : null;

  return (
    <TapMapLoader
      token={token}
      home={data.home}
      lot={data.lot}
      initialSpots={data.estimate?.spots ?? []}
      photoUrls={data.photoUrls}
      bookedFor={bookedFor}
      justBooked={booked === "1"}
      estimateHref={estimatePath(token)}
    />
  );
}
