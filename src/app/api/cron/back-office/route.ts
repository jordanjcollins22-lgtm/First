import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { log, describeError } from "@/lib/log";
import { organizationsWith } from "@/lib/data/back-office-settings";
import { runComplianceReminders } from "@/lib/data/compliance";
import { sweepOnboarding } from "@/lib/data/onboarding";

/**
 * The back office's daily timer: compliance reminders to the owner at 60, 30
 * and 7 days and when overdue, and new-hire checklists (created for anybody
 * hired since the switch went on, and overdue items raised). Every alert is
 * keyed, so a second run the same day sends nothing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const refused = await authorizeScheduledCall(request, "back-office");
  if (refused) return refused;
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const results: Record<string, unknown>[] = [];
  for (const { organizationId, settings } of await organizationsWith("compliance_reminders_on")) {
    try {
      results.push({ organizationId, compliance: await runComplianceReminders(organizationId, settings) });
    } catch (err) {
      log.error("cron.compliance_failed", err, { organizationId, error: describeError(err) });
    }
  }
  for (const { organizationId, settings } of await organizationsWith("onboarding_on")) {
    try {
      results.push({ organizationId, onboarding: await sweepOnboarding(organizationId, settings) });
    } catch (err) {
      log.error("cron.onboarding_failed", err, { organizationId, error: describeError(err) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
