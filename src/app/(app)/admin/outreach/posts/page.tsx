import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getAgentSettings } from "@/lib/data/outreach-agent";
import { answeredToday, answeringLeaderboard, getPostBoard } from "@/lib/data/post-board";
import { AnsweringLeaderboard } from "@/components/marketing/answering-leaderboard";
import { PostBoard } from "@/components/marketing/post-board";
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

export default async function PostsToAnswerPage({ searchParams }: { searchParams?: Promise<{ post?: string }> } = {}) {
  const pinned = ((await searchParams) ?? {}).post ?? null;
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("posts-to-answer", "/admin/outreach");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const owner = isOwnerLevel(profile.roles);

  const now = new Date();
  const [posts, today, settings, leaderboard] = await Promise.all([
    getPostBoard(profile.organization_id, profile.id, now).catch((err) => {
      console.error("Posts to answer failed to load:", err);
      return [];
    }),
    answeredToday(profile.organization_id, profile.id, now).catch(() => 0),
    getAgentSettings(profile.organization_id),
    answeringLeaderboard(profile.organization_id, now).catch(() => []),
  ]);

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

      <AnsweringLeaderboard standings={leaderboard} meId={profile.id} />

      {/* Every post at once, for anybody who wants to see who has what. The
          card above is the way to answer them. */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold">See every post ({posts.length})</summary>
        <div className="mt-3">
          <PostBoard posts={posts} owner={owner} answeredToday={today} dailyLimit={settings.dailyCap} />
        </div>
      </details>
    </div>
  );
}
