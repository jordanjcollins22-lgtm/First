import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured, isStripeConfigured } from "@/lib/env";
import { publicEnv } from "@/lib/public-env";
import { getTapPreEval, tapMapPath } from "@/lib/data/tap-estimate";
import { listExternalMessagesForJob } from "@/lib/data/public-job-messages";
import { recordCheckoutSession } from "@/lib/actions/stripe-settlement";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "@/lib/stripe-customer";
import { fitView, type LngLat } from "@/lib/lot-map";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { EstimateView } from "@/components/tap-pre-eval/estimate-view";

/**
 * The estimate, straight after the map pre-evaluation: what they asked for,
 * what it comes to, and a third down to hold it.
 */
export const dynamic = "force-dynamic";

const MAP_WIDTH = 600;
const MAP_HEIGHT = 400;

/**
 * Back from the card page before Stripe's webhook has landed: ask Stripe
 * directly, and record it the way the webhook would (it is idempotent), so
 * the page says "deposit received" rather than leaving them wondering.
 */
async function settleIfPaid(jobId: string): Promise<void> {
  if (!isStripeConfigured) return;
  const { data } = await createAdminClient().from("job_estimates").select("checkout_session_id, deposit_paid_at").eq("job_id", jobId).maybeSingle();
  if (!data?.checkout_session_id || data.deposit_paid_at) return;
  const session = await stripeClient().checkout.sessions.retrieve(data.checkout_session_id);
  if (session.payment_status === "paid") await recordCheckoutSession(session);
}

/** A satellite picture of the property with each spot numbered on it. */
function spotsMapUrl(points: LngLat[], frame: LngLat[]): string | null {
  if (!publicEnv.mapboxToken || points.length === 0) return null;
  const { center, zoom } = fitView(frame, MAP_WIDTH, MAP_HEIGHT);
  const pins = points.map(([lng, lat], i) => `pin-l-${i + 1}+2f6d3c(${lng.toFixed(6)},${lat.toFixed(6)})`).join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${pins}/${center[0].toFixed(6)},${center[1].toFixed(6)},${zoom}/${MAP_WIDTH}x${MAP_HEIGHT}@2x?access_token=${publicEnv.mapboxToken}`;
}

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ paid?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const { paid } = (await searchParams) ?? {};

  let data = await getTapPreEval(token);
  if (!data) notFound();
  if (!data.estimate) redirect(tapMapPath(token));
  if (paid === "1" && !data.estimate.depositPaidAt) {
    await settleIfPaid(data.intake.jobId).catch((err) => console.error("[estimate] deposit check failed:", err));
    data = (await getTapPreEval(token)) ?? data;
  }
  const estimate = data.estimate!;

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
      justPaid={paid === "1"}
      mapHref={tapMapPath(token)}
    />
  );
}
