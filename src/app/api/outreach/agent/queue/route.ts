import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { queuedForBrowser } from "@/lib/data/outreach-agent";
import { DEFAULT_RECIPE } from "@/lib/outreach-agent-recipe";

/**
 * The comments the browser should go and post, oldest first.
 *
 * The app holds the queue. A comment the agent wrote goes straight in when
 * the owner has said to post without asking, and waits for a tap on the
 * review list when they have not. Either way the browser reads this each
 * minute and posts the first one when the way is clear.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const queue = await queuedForBrowser(profile.organization_id, DEFAULT_RECIPE.pacing.stalePostHours);
  return NextResponse.json({ ok: true, queue });
}
