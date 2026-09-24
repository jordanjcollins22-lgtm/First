import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { agentCounts, getAgentSettings } from "@/lib/data/outreach-agent";
import { countOpenPosts } from "@/lib/data/post-board";
import { settingsForBrowser, standing } from "@/lib/outreach-agent";
import { DEFAULT_RECIPE, EXTENSION_DOWNLOAD_URL, EXTENSION_VERSION, versionIsBehind } from "@/lib/outreach-agent-recipe";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";

/**
 * What the browser is allowed to do right now, and how to read the page.
 *
 * Asked once a minute by the extension. Everything that decides whether it
 * may look is worked out here, in one place, so the browser has one
 * question: am I on, and if not, why. The reasons are the words shown in the
 * popup. It only ever looks: the posts it finds are answered by the team,
 * each from their own account, off the Posts to answer board.
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
  const [settings, counts, toAnswer] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    countOpenPosts(profile.organization_id).catch(() => 0),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });
  const installed = request.nextUrl.searchParams.get("v");

  return NextResponse.json({
    ok: true,
    settings: settingsForBrowser(settings),
    // Nothing waits for the owner's OK any more; an older copy of the
    // extension reads toReview, and zero keeps it from nagging.
    counts: { ...counts, toReview: 0, toAnswer },
    findOnly: true,
    postsUrl: `${request.nextUrl.origin}/admin/outreach/posts`,
    reviewUrl: `${request.nextUrl.origin}/admin/outreach/posts`,
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
