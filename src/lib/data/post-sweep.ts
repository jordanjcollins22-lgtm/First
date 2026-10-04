import { createAdminClient } from "@/lib/supabase/admin";
import { pitchUnpitched, sortReadPosts } from "@/lib/data/post-sorter";
import { draftWaitingPosts } from "@/lib/data/post-draft";

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
export async function sweepPosts(organizationId: string): Promise<{ sorted: number; drafted: number }> {
  let sorted = 0;
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
    drafted = (await draftWaitingPosts(organizationId)).written;
    // Adverts kept before the pitch was named get one, a batch at a time.
    await pitchUnpitched(organizationId, { limit: 30, client: admin });
  } catch (err) {
    console.error("post sweep failed:", err);
  }
  return { sorted, drafted };
}
