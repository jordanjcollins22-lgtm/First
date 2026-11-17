import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordFunnelStep } from "@/lib/data/funnel-events";
import { estimatePath, getTapPreEval, tapMapPath } from "@/lib/data/tap-estimate";
import { settleEstimateIfPaid } from "@/lib/data/estimate-settle";
import { bookingTimesFor } from "@/lib/data/booking-times";
import { getBookingNotice, listOrgAccountManagerIds } from "@/lib/data/public-booking";
import { tierById } from "@/lib/evaluation-tiers";
import { describeNotice } from "@/lib/booking-notice";
import { modeForAddress } from "@/lib/evaluation-mode";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SchedulePicker } from "@/components/tap-pre-eval/schedule-picker";

/**
 * Where Stripe sends them back to. After a deposit nothing is picked: they
 * are told a team member will reach out to set the work day. After a paid
 * evaluation they pick its time, on an account manager's calendar.
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
  // A test run's time was never put on the job; it is kept on the estimate.
  const visitAt = data.test ? estimate.testVisitAt : data.intake.evaluationAt;
  const booked = visitAt && !data.intake.cancelled ? `${dayOnly(visitAt)} at ${timeOnly(visitAt).toLowerCase()}` : null;

  const orgId = data.organizationId;
  // After a deposit there is nothing to pick: a team member reaches out.
  const deposit = estimate.choice === "deposit";
  const done = deposit || Boolean(booked);
  if (orgId && estimate.paidAt && !done) {
    await recordFunnelStep(createAdminClient(), { organizationId: orgId, step: "schedule_viewed", jobId: data.intake.jobId });
  }
  const [times, notice] =
    !done && !deposit && estimate.paidAt && orgId
      ? await Promise.all([
          listOrgAccountManagerIds(orgId).then((ids) => bookingTimesFor(orgId, ids, { lat: data.home?.[1] ?? null, lng: data.home?.[0] ?? null })),
          getBookingNotice(orgId),
        ])
      : [null, null];
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
      times={times}
      noticeText={notice ? describeNotice(notice) : ""}
      digital={mode?.mode === "digital" ? mode.says : null}
      estimateHref={estimatePath(token)}
      test={data.test}
    />
  );
}
