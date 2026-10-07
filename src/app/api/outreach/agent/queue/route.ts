import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";

/**
 * The comments the browser should post: none, ever.
 *
 * The browser used to post the comments the app wrote, all from one
 * account, and one account answering every lead in the county is the
 * pattern Facebook bans. It only finds posts now; the team answers them
 * from their own accounts off the Posts to answer board. Kept, and kept
 * empty, because a copy of the extension from before the change still asks
 * here each minute, and an empty answer is what stops it posting.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ ok: true, queue: [] });
}
