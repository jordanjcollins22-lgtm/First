import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isFacebookConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { publishPhotoToPage } from "@/lib/social/facebook";
import { log } from "@/lib/log";
import { authorizeCron } from "@/lib/cron-auth";

/**
 * Sends the posts whose time has come.
 *
 * Meant to be hit on a schedule. What it actually does with a post depends on
 * whether there is anywhere to send it: with SOCIAL_WEBHOOK_URL set it hands
 * the image and the caption to whatever is on the other end — Zapier, Make,
 * Buffer, a Meta app — and marks it posted when that succeeds. Without it,
 * posts keep their times and wait for somebody to press send in the studio,
 * which is a queue that works rather than a queue that silently does nothing.
 *
 * vercel.json runs this once a day at 10am local, because the Hobby plan
 * rejects anything more frequent. A post therefore goes out at the first run
 * after its slot: morning slots land on time, evening slots land the next
 * morning. On a paid plan change the schedule to "0 * * * *" and every slot
 * becomes exact.
 *
 * Safe to run more often than needed: a post leaves the 'scheduled' state the
 * moment it is handed off, so two runs at once cannot send it twice.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }

  const refused = authorizeCron(request, "social-posts");
  if (refused) return refused;

  const admin = createAdminClient();

  const { data: due, error } = await admin
    .from("social_posts")
    .select("id, caption, image_path, job_id")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ due: 0, sent: 0 });

  const webhook = env.socialWebhookUrl;
  if (!webhook && !isFacebookConfigured) {
    // Nothing to send to. Say so plainly rather than marking them posted.
    log.warn("cron.social_posts.nowhere", { due: due.length });
    return NextResponse.json({
      due: due.length,
      sent: 0,
      waiting: "Set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN, or SOCIAL_WEBHOOK_URL, to publish automatically.",
    });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let sent = 0;

  for (const post of due as { id: string; caption: string | null; image_path: string | null; job_id: string }[]) {
    const imageUrl = post.image_path
      ? `${base}/storage/v1/object/public/social-posts/${post.image_path}`
      : null;
    if (!imageUrl) continue;

    // Claimed before it goes anywhere, so two runs at once cannot both post
    // it. The claim is the channel column, because the status column only
    // knows scheduled and posted.
    const { data: claimed } = await admin
      .from("social_posts")
      .update({ channel: "posting", updated_at: new Date().toISOString() })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .or("channel.is.null,channel.neq.posting")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const channels: string[] = [];

    // Facebook first, straight to the Page. Nextdoor has no way in from
    // here, so those stay copy-and-paste from the studio.
    if (isFacebookConfigured) {
      const result = await publishPhotoToPage({ imageUrl, caption: post.caption ?? "" });
      if (result.ok) channels.push("facebook");
    }

    // Then the hand-off, for anything wired up behind it: Zapier, Make, Buffer.
    if (webhook) {
      try {
        const response = await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: post.id, imageUrl, caption: post.caption ?? "" }),
        });
        if (response.ok) channels.push("webhook");
        else log.warn("social_post.handoff.refused", { postId: post.id, status: response.status });
      } catch (err) {
        log.error("social_post.handoff.failed", err, { postId: post.id });
      }
    }

    if (channels.length === 0) {
      // Nothing took it. Unclaimed, to try again next run.
      await admin.from("social_posts").update({ channel: null, updated_at: new Date().toISOString() }).eq("id", post.id);
      log.warn("social_post.unpublished", { postId: post.id });
      continue;
    }

    await admin
      .from("social_posts")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        channel: channels.join("+"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);
    log.info("social_post.published", { postId: post.id, channels });
    sent++;
  }

  log.info("cron.social_posts", { due: due.length, sent });
  return NextResponse.json({ due: due.length, sent });
}
