import { after, NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { isOwnerLevel } from "@/lib/roles";
import { agentCounts, getAgentSettings } from "@/lib/data/outreach-agent";
import { countOpenPosts } from "@/lib/data/post-board";
import { settingsForBrowser, standing } from "@/lib/outreach-agent";
import { DEFAULT_RECIPE, EXTENSION_DOWNLOAD_URL, EXTENSION_VERSION, versionIsBehind } from "@/lib/outreach-agent-recipe";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import { reviewSourcesDue } from "@/lib/data/review-sources";
import { checkIn, computerKey, runningWithOwners } from "@/lib/data/finder-computers";
import { readsReviews, shareFor } from "@/lib/finder-fleet";
import { GROUPS_FEED_URL } from "@/lib/outreach-agent";
import { handOutHunts } from "@/lib/data/link-hunt";

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
  const [settings, counts, toAnswer, reviews] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    countOpenPosts(profile.organization_id).catch(() => 0),
    // The business's own review pages due a read. Only the owner's copy
    // reads them: it is their Facebook the page opens in.
    isOwnerLevel(profile.roles) ? reviewSourcesDue(profile.organization_id, now).catch(() => []) : Promise.resolve([]),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });
  const installed = request.nextUrl.searchParams.get("v");

  // Which computer this is, checked in before the work is shared out, so a
  // computer that has just been turned on is counted at once.
  const computer = computerKey(request.nextUrl.searchParams.get("computer"), profile.id);
  await checkIn(
    { id: computer, organizationId: profile.organization_id, profileId: profile.id, name: profile.full_name || profile.email, version: installed && /^\d+(\.\d+){0,3}$/.test(installed) ? installed : null },
    now
  ).catch(() => undefined);
  const { running, owners } = await runningWithOwners(profile.organization_id, now).catch(() => ({ running: [], owners: new Set<string>() }));
  const shared = shareFor(settingsForBrowser(settings), running, computer, GROUPS_FEED_URL);
  // Only one computer reads the review pages.
  const myReviews = readsReviews(running, computer, owners) ? reviews : [];
  // Which copy asked, so the app can say when it needs updating even while
  // the finder is paused and nothing is being looked at. Never holds up the
  // answer.
  if (installed && /^\d+(\.\d+){0,3}$/.test(installed)) {
    const supabase = await createClient();
    after(async () => {
      await supabase
        .from("outreach_agent_settings")
        .update({ extension_version: installed, extension_seen_at: now.toISOString() })
        .eq("organization_id", profile.organization_id);
    });
  }

  // A post read without its link, for the extension to go back for, when
  // it says it is ready for one. Copies before 2.13 cannot, so they are not
  // handed any: a post handed out waits a while before it is handed out again.
  const linkHunts =
    state.active && request.nextUrl.searchParams.get("hunt") === "1" && !versionIsBehind(installed, "2.13.0")
      ? await handOutHunts(profile.organization_id, now, 1).catch(() => [])
      : [];

  return NextResponse.json({
    ok: true,
    settings: shared,
    linkHunts,
    computer: { id: computer, place: shared.share.place, of: shared.share.of },
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
    reviews: myReviews,
    extension: {
      expectedVersion: EXTENSION_VERSION,
      installedVersion: installed,
      updateAvailable: versionIsBehind(installed, EXTENSION_VERSION),
      downloadUrl: EXTENSION_DOWNLOAD_URL,
    },
  });
}
