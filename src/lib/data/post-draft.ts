import { createAdminClient } from "@/lib/supabase/admin";
import { isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { BOARD_MAX_AGE_DAYS } from "@/lib/post-board";
import { daysOld } from "@/lib/post-age";
import { readAndDraftFor } from "@/lib/data/read-and-draft";

/** A few at a time: each is a model call, and more arrive on the next pass. */
const PER_PASS = 6;

/**
 * Write the comment for every post on the board that does not have one yet.
 *
 * Only posts sorted as for us (kind "request") and still on the board: an
 * advert, a question from another trade, a job ad or chatter never gets a
 * comment written. Each is written once, with the neutral opener and the
 * link left as a placeholder, and kept on the post; whoever takes it gets
 * their own opener and their own tracked link when they use it.
 *
 * Runs with the service role, because it runs after the finder hands posts
 * in and on the Reddit timer, where nobody is signed in. Every write is
 * scoped to the one organization it was called for.
 */
export async function draftWaitingPosts(organizationId: string, limit = PER_PASS): Promise<{ written: number; refused: number }> {
  if (!isAnthropicConfigured) return { written: 0, refused: 0 };
  const admin = createAdminClient();
  const since = new Date(Date.now() - BOARD_MAX_AGE_DAYS * 86_400_000).toISOString();
  const [{ data: rows }, { data: org }] = await Promise.all([
    admin
      .from("outreach_seen_posts")
      .select("id, text, screenshot_path, posted_at, age_days, created_at")
      .eq("organization_id", organizationId)
      .eq("kind", "request")
      .eq("decision", "read")
      .is("drafted_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);
  if (!rows || rows.length === 0) return { written: 0, refused: 0 };

  // Claimed before any writing starts: two people opening the card at once
  // both start a pass, and a post is written once, by whichever claimed it.
  const { data: claimed } = await admin
    .from("outreach_seen_posts")
    .update({ drafted_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .in("id", rows.map((row) => row.id))
    .is("drafted_at", null)
    .select("id");
  const mine = new Set((claimed ?? []).map((row) => row.id));

  let written = 0;
  let refused = 0;
  for (const row of rows) {
    if (!mine.has(row.id)) continue;
    if (!row.screenshot_path && !(row.text ?? "").trim()) continue;
    const days = daysOld(row.posted_at ?? null, row.age_days ?? null, row.created_at, new Date());
    const read = await readAndDraftFor(
      { screenshotPath: row.screenshot_path ?? null, pastedText: row.text ?? "", kind: "comment", ageDays: days },
      { supabase: admin, organizationId, organizationName: org?.name ?? "", roles: [] }
    );
    const draft = read.ok ? read.draft : null;
    if (draft) written += 1;
    else refused += 1;
    await admin
      .from("outreach_seen_posts")
      .update({
        drafted_at: new Date().toISOString(),
        draft_comment: draft,
        draft_asked_by: read.ok ? read.askedBy : null,
        draft_service: read.ok ? read.service : null,
        draft_note: read.ok ? read.note : null,
        draft_error: read.ok ? read.draftNote : read.error,
      })
      .eq("organization_id", organizationId)
      .eq("id", row.id);
  }
  log.info("agent.posts_drafted", { organizationId, written, refused });
  return { written, refused };
}
