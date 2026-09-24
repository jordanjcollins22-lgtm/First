import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { agentCounts, countReadyForReview, getAgentSettings } from "@/lib/data/outreach-agent";
import { settingsForBrowser, standing } from "@/lib/outreach-agent";
import { DEFAULT_RECIPE, EXTENSION_DOWNLOAD_URL, EXTENSION_VERSION, versionIsBehind } from "@/lib/outreach-agent-recipe";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";

/**
 * What the browser is allowed to do right now, and how to read the page.
 *
 * Asked once a minute by the extension. Everything that decides whether a
 * comment may go up is worked out here, in one place, so the browser has one
 * question: am I on, and if not, why. The reasons are the words shown in the
 * popup.
 *
 * The recipe rides along: every selector and every wait the extension uses
 * on a Facebook page. A layout change is fixed in the recipe and deployed,
 * and no copy of the extension has to be downloaded again. The version the
 * app expects rides along too, so the popup can say when a download is due.
 *
 * Signed in the same way as any page: the extension sends the app's own
 * cookies. Nobody's key lives in the browser.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const now = new Date();
  const [settings, counts, toReview] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    countReadyForReview(profile.organization_id),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });
  const installed = request.nextUrl.searchParams.get("v");

  return NextResponse.json({
    ok: true,
    settings: settingsForBrowser(settings),
    counts: { ...counts, toReview },
    reviewUrl: `${request.nextUrl.origin}/admin/outreach/agent#review`,
    active: state.active,
    because: state.active ? null : state.because,
    pausedUntil: settings.pausedUntil,
    pauseReason: settings.pauseReason,
    who: profile.full_name || profile.email,
    now: now.toISOString(),
    recipe: DEFAULT_RECIPE,
    extension: {
      expectedVersion: EXTENSION_VERSION,
      installedVersion: installed,
      updateAvailable: versionIsBehind(installed, EXTENSION_VERSION),
      downloadUrl: EXTENSION_DOWNLOAD_URL,
    },
  });
}
