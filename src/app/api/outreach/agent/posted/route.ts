import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { pauseAgent, updateSeen } from "@/lib/data/outreach-agent";
import { looksLikeBlock } from "@/lib/outreach-agent";
import { createClient } from "@/lib/supabase/server";

/**
 * What happened when the browser tried to post.
 *
 * Posted: the words as they went up are kept against the link, the same as
 * a person pasting them back. Failed: the reason is kept, and when the
 * reason reads like Facebook telling the account to stop, the agent is
 * paused for a day before anything else is tried. A second attempt straight
 * after a block is what turns a day's block into a month's.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { seenId?: string; linkId?: string; ok?: boolean; postedText?: string; error?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!body.seenId || !body.linkId) return NextResponse.json({ error: "Which post?" }, { status: 400 });

  const supabase = await createClient();
  const now = new Date();

  if (body.ok) {
    const posted = (body.postedText ?? "").trim().slice(0, 4000);
    await Promise.all([
      supabase
        .from("outreach_links")
        .update({ posted_comment: posted || null, posted_comment_at: now.toISOString() })
        .eq("organization_id", profile.organization_id)
        .eq("id", body.linkId),
      updateSeen(profile.organization_id, body.seenId, { decision: "posted", reason: null }),
    ]);
    revalidatePath("/admin/outreach");
    return NextResponse.json({ ok: true, paused: false });
  }

  const reason = (body.error ?? "Couldn't post.").slice(0, 500);
  const blocked = looksLikeBlock(reason);
  await updateSeen(profile.organization_id, body.seenId, { decision: "failed", reason });
  if (blocked) {
    const until = new Date(now.getTime() + 24 * 3_600_000);
    await pauseAgent(profile.organization_id, profile.id, until, `Facebook said: ${reason.slice(0, 200)}`);
  }
  revalidatePath("/admin/outreach");
  return NextResponse.json({ ok: true, paused: blocked });
}
