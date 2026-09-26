import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getAgentSettings } from "@/lib/data/outreach-agent";
import { answeredToday, getPostBoard } from "@/lib/data/post-board";
import { PostBoard } from "@/components/marketing/post-board";

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

export default async function PostsToAnswerPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("posts-to-answer", "/admin/outreach");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const owner = isOwnerLevel(profile.roles);

  const now = new Date();
  const [posts, today, settings] = await Promise.all([
    getPostBoard(profile.organization_id, profile.id, now).catch((err) => {
      console.error("Posts to answer failed to load:", err);
      return [];
    }),
    answeredToday(profile.organization_id, profile.id, now).catch(() => 0),
    getAgentSettings(profile.organization_id),
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
          People in local Facebook groups asking for lawn and landscaping work, found for you. Pick one, press
          &ldquo;Answer this one&rdquo; and a comment is written for you with your own link, so anything it books
          counts for you. Copy it, open the post, comment from your own Facebook, then press &ldquo;I posted
          it&rdquo;. Two of the team can answer each post; once two have it, it moves to &ldquo;Two answers
          already&rdquo; so nobody piles on.
          {owner && " As the owner you can add yours to any post, however many have answered it."}
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <PostBoard posts={posts} owner={owner} answeredToday={today} dailyLimit={settings.dailyCap} />
      </section>
    </div>
  );
}
