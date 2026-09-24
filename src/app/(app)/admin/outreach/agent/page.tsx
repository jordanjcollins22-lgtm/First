import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { agentCounts, getAgentSettings, groupsToJoin, recentAgentActivity } from "@/lib/data/outreach-agent";
import { standing } from "@/lib/outreach-agent";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import { AgentSettingsForm } from "@/components/marketing/agent-settings";
import { AgentActivity } from "@/components/marketing/agent-activity";
import { GroupsToJoin } from "@/components/marketing/groups-to-join";
import { AgentReview } from "@/components/marketing/agent-review";

/**
 * The group agent.
 *
 * The browser extension looks through the Facebook groups listed here on a
 * timer, sends what it finds to the app, and posts the comments the app
 * writes. This page is the owner's hand on it: which groups, how many a
 * day, what hours, and the stop button. Below that, every post it has
 * looked at and what it decided.
 */
export const dynamic = "force-dynamic";

export default async function GroupAgentPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("group-agent", "/admin/outreach");
  const profile = await getCurrentProfile();
  const owner = isOwnerLevel(profile?.roles ?? []);
  if (!profile) return null;

  const now = new Date();
  const [settings, counts, activity, toJoin] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    recentAgentActivity(profile.organization_id).catch(() => []),
    groupsToJoin(profile.organization_id).catch(() => []),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <Link href="/admin/outreach" className="text-xs text-muted-foreground hover:underline">
          ← Link Tracking
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Group Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The browser button&apos;s big brother. With the extension installed and Chrome open, it reads your
          groups feed, searches Facebook for people asking, and looks at any groups listed below. Any post that
          mentions the work is read, the comment is written with a tracked link and the poster&apos;s name,
          and it is posted under the caps set here. Everything it does lands on the Link Tracking board like a
          comment written by hand.
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <p className="text-sm">
          {state.active ? (
            <span className="font-medium text-emerald-700">On.</span>
          ) : (
            <span className="font-medium text-amber-700">Not posting right now: {state.because}.</span>
          )}{" "}
          <span className="text-muted-foreground">
            {counts.postedToday} posted today, {counts.postedThisHour} in the last hour, {counts.queued} approved and waiting to post.
          </span>
          {settings.pauseReason && <span className="block text-muted-foreground">{settings.pauseReason}</span>}
        </p>
      </section>

      <section id="review" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">Comments to approve</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The post, and the comment it wrote. Change the words if you like, then approve and the browser posts it
          on its next minute. Decline and the post is left alone.
        </p>
        <AgentReview rows={activity.filter((row) => row.decision === "ready")} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Settings</h2>
        <AgentSettingsForm settings={settings} owner={owner} paused={!state.active && state.because === "paused"} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-1 text-sm font-semibold">Groups to join</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Search found people asking for work in these groups, but you&apos;re not a member, so nothing could be
          posted. Most leads first. Open one, join it, then press &ldquo;I joined&rdquo; and its posts get
          answered from then on.
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
