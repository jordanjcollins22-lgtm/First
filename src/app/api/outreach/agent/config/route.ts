import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { agentCounts, getAgentSettings } from "@/lib/data/outreach-agent";
import { settingsForBrowser, standing } from "@/lib/outreach-agent";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";

/**
 * What the browser is allowed to do right now.
 *
 * Asked once a minute by the extension. Everything that decides whether a
 * comment may go up is worked out here, in one place, so the browser has one
 * question: am I on, and if not, why. The reasons are the words shown in the
 * popup.
 *
 * Signed in the same way as any page: the extension sends the app's own
 * cookies. Nobody's key lives in the browser.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const now = new Date();
  const [settings, counts] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });

  return NextResponse.json({
    ok: true,
    settings: settingsForBrowser(settings),
    counts,
    active: state.active,
    because: state.active ? null : state.because,
    pausedUntil: settings.pausedUntil,
    pauseReason: settings.pauseReason,
    who: profile.full_name || profile.email,
    now: now.toISOString(),
  });
}
