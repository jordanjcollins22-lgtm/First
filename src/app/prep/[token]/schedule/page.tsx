import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordFunnelStep } from "@/lib/data/funnel-events";
import { estimatePath, getTapPreEval, tapMapPath } from "@/lib/data/tap-estimate";
import { settleEstimateIfPaid } from "@/lib/data/estimate-settle";
import { bookingTimesFor } from "@/lib/data/booking-times";
import { getBookingNotice, listOrgEvaluatorIds } from "@/lib/data/public-booking";
import { tierById } from "@/lib/evaluation-tiers";
import { describeNotice } from "@/lib/booking-notice";
import { startDayOptions } from "@/lib/start-day";
import { modeForAddress } from "@/lib/evaluation-mode";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SchedulePicker } from "@/components/tap-pre-eval/schedule-picker";

/**
 * The first visit, picked once they have paid. After a deposit that is the
 * day the crew starts work (a preferred day the team confirms); after a paid
 * evaluation it is the evaluation, in an evaluator's time slot. Stripe sends
 * them here from checkout.
 */
export const dynamic = "force-dynamic";

export default async function SchedulePage({
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
  // Back from Stripe before its webhook: ask Stripe, so they can go straight on.
  if (paid === "1" && !data.estimate.paidAt) {
    await settleEstimateIfPaid(data.intake.jobId).catch((err) => console.error("[schedule] payment check failed:", err));
    data = (await getTapPreEval(token)) ?? data;
  }
  const estimate = data.estimate!;
  // Not paid, and not just back from paying: the estimate is where they choose.
  if (!estimate.paidAt && paid !== "1") redirect(estimatePath(token));

  const tier = tierById(data.tiers, estimate.evaluationTier);
  const booked =
    data.intake.evaluationAt && !data.intake.cancelled ? `${dayOnly(data.intake.evaluationAt)} at ${timeOnly(data.intake.evaluationAt).toLowerCase()}` : null;

  const orgId = data.organizationId;
  // After a deposit the first visit is the work, picked as a preferred start
  // day; after a paid evaluation it is the evaluation, in an evaluator's slot.
  const deposit = estimate.choice === "deposit";
  const done = deposit ? Boolean(estimate.startDay) : Boolean(booked);
  if (orgId && estimate.paidAt && !done) {
    await recordFunnelStep(createAdminClient(), { organizationId: orgId, step: "schedule_viewed", jobId: data.intake.jobId });
  }
  const [times, notice] =
    !done && !deposit && estimate.paidAt && orgId
      ? await Promise.all([
          listOrgEvaluatorIds(orgId).then((ids) => bookingTimesFor(orgId, ids, { lat: data.home?.[1] ?? null, lng: data.home?.[0] ?? null })),
          getBookingNotice(orgId),
        ])
      : [null, null];
  const startNotice = deposit && orgId ? await getBookingNotice(orgId) : null;
  const mode = data.home && data.intake.address ? modeForAddress(data.home[1], data.home[0], data.intake.address) : null;

  return (
    <SchedulePicker
      token={token}
      businessName={data.intake.businessName}
      businessPhone={data.intake.businessPhone}
      clientFirstName={data.intake.clientFirstName}
      paid={Boolean(estimate.paidAt)}
      choice={estimate.choice}
      tier={tier}
      booked={booked}
      startDay={estimate.startDay}
      startDays={deposit && !done ? startDayOptions(new Date(), startNotice?.timeZone) : []}
      times={times}
      noticeText={notice ? describeNotice(notice) : ""}
      digital={mode?.mode === "digital" ? mode.says : null}
      estimateHref={estimatePath(token)}
    />
  );
}
