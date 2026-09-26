import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getAgentSettings } from "@/lib/data/outreach-agent";
import { affiliateClosedBoard, answeredPostsFor, answeredToday, getPostBoard } from "@/lib/data/post-board";
import { AnsweringLeaderboard } from "@/components/marketing/answering-leaderboard";
import { AnsweredPosts } from "@/components/marketing/answered-posts";
import { CommentCard } from "@/components/marketing/comment-card";

/**
 * Posts to answer.
 *
 * The browser reads Facebook for people asking for the work and brings
 * every one here. It never comments: one account answering every lead in
 * the county is what gets an account banned. The answering is shared out
 * instead, each person from their own account, each with a comment written
 * for them and their own tracked link.
 */
export const dynamic = "force-dynamic";

export default async function PostsToAnswerPage({ searchParams }: { searchParams?: Promise<{ post?: string; who?: string }> } = {}) {
  const params = (await searchParams) ?? {};
  const pinned = params.post ?? null;
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("posts-to-answer", "/admin/outreach");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const owner = isOwnerLevel(profile.roles);
  // The owner can look at anybody's answered posts from the leaderboard;
  // everybody else sees their own.
  const whoId = owner && params.who ? params.who : profile.id;

  const now = new Date();
  const [posts, today, settings, leaderboard, answered] = await Promise.all([
    getPostBoard(profile.organization_id, profile.id, now).catch((err) => {
      console.error("Posts to answer failed to load:", err);
      return [];
    }),
    answeredToday(profile.organization_id, profile.id, now).catch(() => 0),
    getAgentSettings(profile.organization_id),
    affiliateClosedBoard(profile.organization_id, now).catch((err) => {
      // Said, not swallowed: an empty board used to be indistinguishable
      // from one that failed to load.
      console.error("Affiliate leaderboard failed to load:", err);
      return null;
    }),
    answeredPostsFor(profile.organization_id, whoId).catch((err) => {
      console.error("Answered posts failed to load:", err);
      return null;
    }),
  ]);
  const whose = whoId === profile.id ? null : leaderboard?.find((s) => s.profileId === whoId)?.name ?? "Their";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <Link href="/admin/outreach" className="text-xs text-muted-foreground hover:underline">
            ← Link Tracking
          </Link>
          {owner && (
            <Link href="/admin/outreach/agent" className="text-xs font-medium hover:underline">
              Where posts come from →
            </Link>
          )}
        </div>
        <h1 className="mt-1 text-xl font-semibold">Posts to Answer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One post at a time. Respond and a comment is written for you with your own link; copy it, go to the post,
          paste it from your own account. Not a job, or an ad? Say so and the next one comes up.
        </p>
      </header>

      <CommentCard posts={posts} pinned={pinned} owner={owner} answeredToday={today} dailyLimit={settings.dailyCap} />

      {leaderboard ? (
        <AnsweringLeaderboard standings={leaderboard} meId={profile.id} viewingId={whoId} linkNames={owner} />
      ) : (
        <p className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          The leaderboard couldn&apos;t load just now. Reload the page.
        </p>
      )}

      {answered ? (
        <AnsweredPosts posts={answered} whose={whose} />
      ) : (
        <p className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Your answered posts couldn&apos;t load just now. Reload the page.
        </p>
      )}
    </div>
  );
}
