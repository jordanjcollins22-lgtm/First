import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { MarketingPlay } from "@/lib/marketing-plays";
import { learnedDefaults, playPolicy, type LearnedDefault, type PlayReview } from "@/lib/marketing-approval";

export interface MarketingState {
  plays: MarketingPlay[];
  reviews: PlayReview[];
  defaults: LearnedDefault[];
  /** Plays the app approved on this read, because they looked like approved ones. */
  autoApproved: number;
}

/**
 * The marketing plays, made by the database from evaluations and clients,
 * with the decisions so far and what has been learned from them.
 *
 * Read with a sync first, so a client who paid a minute ago is on the
 * list when the page opens. Then the app's own pass: with enough trust,
 * plays that look like approved ones are approved here and now, each
 * with the reason recorded.
 */
export async function marketingState(options: { sync?: boolean; includeDone?: boolean } = {}): Promise<MarketingState> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (options.sync !== false) {
    const { error } = await supabase.rpc("marketing_sync_and_refresh", { org });
    if (error) console.error("[marketing] sync failed:", error.message);
  }
  const [{ data: listed, error }, { data: stateRaw, error: stateError }] = await Promise.all([
    supabase.rpc("marketing_plays_list", { org, include_done: options.includeDone !== false }),
    supabase.rpc("marketing_approval_state", { org }),
  ]);
  if (error) throw error;
  if (stateError) throw stateError;
  const plays = (Array.isArray(listed) ? listed : []) as unknown as MarketingPlay[];
  const state = (stateRaw ?? {}) as { reviews?: PlayReview[] };
  const reviews = state.reviews ?? [];

  let autoApproved = 0;
  for (const play of plays) {
    if (play.status !== "open" || play.approval !== "pending") continue;
    const policy = playPolicy(play, reviews);
    if (policy.decision !== "auto") continue;
    const { error: reviewError } = await supabase.rpc("marketing_play_review", { org, the_play: play.id, decision: "auto", note: policy.why });
    if (reviewError) {
      console.error("[marketing] could not approve on the app's behalf:", reviewError.message);
      continue;
    }
    play.approval = "auto";
    play.approvedAt = new Date().toISOString();
    autoApproved++;
  }
  return { plays, reviews, defaults: learnedDefaults(reviews), autoApproved };
}

/** The plays alone, for callers that only list them. */
export async function listMarketingPlays(options: { sync?: boolean; includeDone?: boolean } = {}): Promise<MarketingPlay[]> {
  return (await marketingState(options)).plays;
}
