import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";

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

  const secret = env.cronSecret;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
  if (!webhook) {
    // Nothing to send to. Say so plainly rather than marking them posted.
    return NextResponse.json({
      due: due.length,
      sent: 0,
      waiting: "Set SOCIAL_WEBHOOK_URL to publish automatically.",
    });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let sent = 0;

  for (const post of due as { id: string; caption: string | null; image_path: string | null; job_id: string }[]) {
    const imageUrl = post.image_path
      ? `${base}/storage/v1/object/public/social-posts/${post.image_path}`
      : null;
    if (!imageUrl) continue;

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: post.id, imageUrl, caption: post.caption ?? "" }),
      });
      if (!response.ok) continue;

      await admin
        .from("social_posts")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
          channel: "webhook",
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id)
        // Only if it is still scheduled, so two runs at once cannot both send it.
        .eq("status", "scheduled");

      sent++;
    } catch (err) {
      console.error("social post handoff failed:", err);
    }
  }

  return NextResponse.json({ due: due.length, sent });
}
