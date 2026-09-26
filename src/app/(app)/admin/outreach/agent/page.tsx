import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { agentCounts, getAgentSettings, groupsToJoin, lastLook, lastRedditLook, recentAgentActivity } from "@/lib/data/outreach-agent";
import type { RedditLook } from "@/lib/data/reddit-finder";
import { standing } from "@/lib/outreach-agent";
import { BUSINESS_TIME_ZONE, shortWhen } from "@/lib/time-zone";
import { AgentSettingsForm } from "@/components/marketing/agent-settings";
import { AgentActivity } from "@/components/marketing/agent-activity";
import { GroupsToJoin } from "@/components/marketing/groups-to-join";
import { AgentPicker } from "@/components/marketing/agent-picker";
import { AgentBusinesses } from "@/components/marketing/agent-businesses";
import { listBusinesses } from "@/lib/data/post-sorter";

/**
 * The group agent.
 *
 * The browser extension looks through Facebook on a timer and sends every
 * post it reads to the app, where the ones asking for work go on the Posts
 * to answer board for the team. It never comments. This page is the
 * owner's hand on it: where it looks, what hours, how many answers a day
 * per person, and the stop button. Below that, every post it has read.
 */
export const dynamic = "force-dynamic";

export default async function GroupAgentPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("group-agent", "/admin/outreach");
  const profile = await getCurrentProfile();
  const owner = isOwnerLevel(profile?.roles ?? []);
  if (!profile) return null;

  const now = new Date();
  const [settings, counts, activity, toJoin, look, toPick, businesses, redditLook] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    recentAgentActivity(profile.organization_id, 80, "decided").catch(() => []),
    groupsToJoin(profile.organization_id).catch(() => []),
    lastLook(profile.organization_id).catch(() => null),
    recentAgentActivity(profile.organization_id, 200, "read").catch(() => []),
    listBusinesses(profile.organization_id).catch(() => []),
    lastRedditLook(profile.organization_id).catch(() => null),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });
  const because = state.active ? null : state.because;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <Link href="/admin/outreach" className="text-xs text-muted-foreground hover:underline">
          ← Link Tracking
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Group Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The finder. With the extension installed and Chrome open, it reads your groups feed, searches
          Facebook for people asking, and looks at any groups listed below. It never comments: every post it
          reads comes here and is sorted, and the people asking for work go on the{" "}
          <Link href="/admin/outreach/posts" className="underline">
            Posts to answer
          </Link>{" "}
          board, where the team answers them from their own accounts, each with a comment written for them and
          their own tracked link.
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <p className="text-sm">
          {because === "paused" ? (
            <span className="font-medium text-amber-700">Paused. It won&apos;t look until you press Resume below.</span>
          ) : because === "outside hours" ? (
            <span className="font-medium text-amber-700">Outside its hours; it looks again from {settings.activeFrom}.</span>
          ) : (
            <span className="font-medium text-emerald-700">On. Looking every {settings.scanEveryMinutes} minutes.</span>
          )}
          {settings.pauseReason && <span className="block text-muted-foreground">{settings.pauseReason}</span>}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {look
            ? `Last look ${shortWhen(look.at)} at ${look.name ?? "a page"}: read ${look.posts ?? 0} posts, ${look.mentioned ?? 0} mentioned the work` +
              ((look.mentionedNoLink ?? 0) > 0 ? ` (${look.mentionedNoLink} without a link it could open)` : "") +
              `, ${look.sent ?? 0} sent to be read.` +
              (look.version ? ` Extension v${look.version}.` : "")
            : "No look recorded yet. Press Look now in the extension popup."}
        </p>
        {settings.redditEnabled && (
          <p className="mt-1 text-xs text-muted-foreground">
            {redditLook ? describeRedditLook(redditLook) : "Reddit: no look yet. The first one runs within half an hour."}
          </p>
        )}
      </section>

      <section id="posts" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">Posts it read</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every post the extension reads is sorted as it arrives: people asking for work go on the Posts to answer
          board, ads go straight to the Businesses list below, and the rest stay here. If it put a post in the wrong
          pile, move it; a post moved to &ldquo;Asking for work&rdquo; goes on the board, and your moves are kept so
          it learns. Pass takes a post off the board.
        </p>
        <AgentPicker rows={toPick} />
      </section>

      <section id="businesses" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">Businesses advertising ({businesses.length})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Everyone it has seen advertising their own work in the groups, kept for subcontracting later. Only what they
          wrote in their posts, one row per business however many groups they post in.
        </p>
        <AgentBusinesses rows={businesses} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Settings</h2>
        <AgentSettingsForm settings={settings} owner={owner} paused={!state.active && state.because === "paused"} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">Groups to join</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Search found people asking for work in these groups, but you&apos;re not a member. Most leads first. Open
          one, join it, then press &ldquo;I joined&rdquo; and its posts show up in your feed from then on.
        </p>
        <GroupsToJoin groups={toJoin} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">What it has looked at</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every post it was shown that mentioned the work, newest first, with what it decided. A post marked
          &ldquo;over the cap&rdquo; is a real lead nobody answered: open it and answer it yourself.
        </p>
        <AgentActivity rows={activity} />
      </section>

      <section className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Install</h2>
        <p>
          Load the <code>extension</code> folder from the repository in Chrome at <code>chrome://extensions</code>{" "}
          with Developer mode on. Sign in to this app in the same Chrome and stay signed in to Facebook. The
          popup on the toolbar shows what it is doing and has the pause button. It only runs while Chrome is
          open.
        </p>
      </section>
    </div>
  );
}

/** The last Reddit look in one line: when, what it kept, and what would not answer. */
function describeRedditLook(look: RedditLook): string {
  const kept = look.subreddits.reduce((n, s) => n + s.kept, 0);
  const matched = look.subreddits.reduce((n, s) => n + s.matched, 0);
  const failed = look.subreddits.filter((s) => !s.ok);
  return (
    `Reddit, last look ${shortWhen(look.at)}: read ${look.subreddits.map((s) => `r/${s.name} (${s.read})`).join(", ")}; ` +
    `${matched} mentioned the work, ${kept} new.` +
    (failed.length > 0 ? ` Couldn't read ${failed.map((s) => `r/${s.name} (${s.error ?? "no answer"})`).join(", ")}.` : "")
  );
}
