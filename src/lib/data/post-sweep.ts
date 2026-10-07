import { createAdminClient } from "@/lib/supabase/admin";
import { pitchUnpitched, sortReadPosts } from "@/lib/data/post-sorter";
import { draftWaitingPosts } from "@/lib/data/post-draft";
import { BOARD_MAX_AGE_DAYS } from "@/lib/post-board";
import { requestByWords, wordsReason } from "@/lib/post-words";

/**
 * Everything the finder brought in, sorted and ready to answer, with nobody
 * pressing anything.
 *
 * Posts are sorted as they arrive, but a batch that failed, or more at once
 * than one call takes, used to sit as "not sorted yet" until somebody found
 * the button. This sweeps them up: anything unsorted is sorted, and any post
 * for us still without its comment gets one written, so it lands on Posts
 * to Answer ready to use. Run on the finder's timer and whenever the board
 * or the finder page is opened. Cheap when there is nothing to do: two reads
 * and no model call.
 *
 * Never throws.
 */
export async function sweepPosts(organizationId: string): Promise<{ sorted: number; drafted: number; flagged: number }> {
  let sorted = 0;
  let flagged = 0;
  let drafted = 0;
  try {
    const admin = createAdminClient();
    // Two rounds at most, so a big arrival is cleared in one sweep without
    // ever running long.
    for (let round = 0; round < 2; round += 1) {
      const result = await sortReadPosts(organizationId, { limit: 40, client: admin });
      sorted += result.sorted;
      if (result.sorted < 40) break;
    }
    // Whatever the model could not sort (no key, no credit, a failed call)
    // gets the free look by its words, so a neighbour asking for yard work
    // reaches the board now rather than whenever a sort next runs.
    flagged = await flagByWords(admin, organizationId);
    drafted = (await draftWaitingPosts(organizationId)).written;
    // Adverts kept before the pitch was named get one, a batch at a time.
    await pitchUnpitched(organizationId, { limit: 30, client: admin });
  } catch (err) {
    console.error("post sweep failed:", err);
  }
  return { sorted, drafted, flagged };
}

/**
 * Unsorted posts still young enough for the board, looked at by their words
 * alone. A match goes on the board marked as flagged by words; anything
 * else is left unsorted for the next proper sort, never called "other".
 */
async function flagByWords(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<number> {
  const since = new Date(Date.now() - BOARD_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("outreach_seen_posts")
    .select("id, text")
    .eq("organization_id", organizationId)
    .eq("decision", "read")
    .is("kind", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  let flagged = 0;
  const now = new Date().toISOString();
  for (const row of data ?? []) {
    const verdict = requestByWords(row.text ?? "");
    if (!verdict.request) continue;
    const { error } = await admin
      .from("outreach_seen_posts")
      .update({ kind: "request", kind_by: "words", category: "for-us", sort_reason: wordsReason(verdict.matched), updated_at: now })
      .eq("organization_id", organizationId)
      .eq("id", row.id)
      .is("kind", null);
    if (!error) flagged += 1;
  }
  return flagged;
}
