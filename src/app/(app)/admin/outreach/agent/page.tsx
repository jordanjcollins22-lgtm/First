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
import { GroupsToJoin } from "@/components/marketing/groups-to-join";
import { AgentPicker } from "@/components/marketing/agent-picker";
import { FinderPower, RedditSwitch } from "@/components/marketing/platform-switch";
import { AgentBusinesses } from "@/components/marketing/agent-businesses";
import { listBusinesses } from "@/lib/data/post-sorter";
import { Download } from "lucide-react";
import extension from "../../../../../../extension/manifest.json";

/**
 * Where posts come from: the finder.
 *
 * The browser extension reads Facebook, and the app reads Reddit, and
 * every post asking for the work goes on Posts to Answer. It never
 * comments. One card on top says whether it is running, with the switch,
 * and what each platform last found; everything else is folded away
 * underneath until somebody wants it.
 */
export const dynamic = "force-dynamic";

export default async function GroupAgentPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("group-agent", "/admin/outreach/posts");
  const profile = await getCurrentProfile();
  const owner = isOwnerLevel(profile?.roles ?? []);
  if (!profile) return null;

  const now = new Date();
  const [settings, counts, toJoin, look, toPick, businesses, redditLook] = await Promise.all([
    getAgentSettings(profile.organization_id),
    agentCounts(profile.organization_id, now),
    groupsToJoin(profile.organization_id).catch(() => []),
    lastLook(profile.organization_id).catch(() => null),
    recentAgentActivity(profile.organization_id, 200, "read").catch(() => []),
    listBusinesses(profile.organization_id).catch(() => []),
    lastRedditLook(profile.organization_id).catch(() => null),
  ]);
  const state = standing({ settings, now, timeZone: BUSINESS_TIME_ZONE, ...counts });
  const because = state.active ? null : state.because;
  const paused = because === "paused";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header>
        <Link href="/admin/outreach/posts" className="text-xs text-muted-foreground hover:underline">
          ← Posts to Answer
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Where Posts Come From</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The finder reads Facebook and Reddit for people asking for the work and puts them on Posts to Answer. It
          never comments.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {paused ? (
              <span className="font-semibold text-amber-700">Paused. Nothing is being read.</span>
            ) : because === "outside hours" ? (
              <span className="font-semibold text-amber-700">Resting. It looks again from {settings.activeFrom}.</span>
            ) : (
              <span className="font-semibold text-emerald-700">On. Looking every {settings.scanEveryMinutes} minutes.</span>
            )}
            {paused && settings.pauseReason && <span className="block text-xs text-muted-foreground">{settings.pauseReason}</span>}
          </p>
          <FinderPower paused={paused} owner={owner} />
        </div>

        <ul className="mt-3 divide-y divide-border/60 border-t border-border/60 text-sm">
          <li className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Facebook</span>
              <span className="text-xs text-muted-foreground">
                {look?.version ? `Extension v${look.version}` : "Chrome extension"}
                {look?.version && look.version !== extension.version && (
                  <span className="ml-1 font-medium text-amber-700">· v{extension.version} is out, download it below</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {look
                ? `Last look ${shortWhen(look.at)}: read ${look.posts ?? 0} posts, ${look.mentioned ?? 0} mentioned the work, ${look.sent ?? 0} kept.`
                : "No look yet. It reads while Chrome is open with the extension installed."}
            </p>
          </li>
          <li className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Reddit</span>
              <RedditSwitch enabled={settings.redditEnabled} owner={owner} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {!settings.redditEnabled
                ? `Off. When on, the app reads ${settings.redditSubreddits.map((r) => `r/${r}`).join(", ") || "the listed subreddits"} every half hour.`
                : redditLook
                  ? describeRedditLook(redditLook)
                  : "No look yet. The first one runs within half an hour."}
            </p>
          </li>
        </ul>
      </section>

      <Fold title="Posts it read" count={toPick.length}>
        <p className="mb-3 text-xs text-muted-foreground">
          Sorted as they arrive: people asking for work go on Posts to Answer, ads go to Businesses. If one landed in
          the wrong pile, move it.
        </p>
        <AgentPicker rows={toPick} />
      </Fold>

      <Fold title="Businesses advertising" count={businesses.length}>
        <p className="mb-3 text-xs text-muted-foreground">Kept for subcontracting later, one row per business.</p>
        <AgentBusinesses rows={businesses} />
      </Fold>

      {toJoin.length > 0 && (
        <Fold title="Groups to join" count={toJoin.length}>
          <p className="mb-3 text-xs text-muted-foreground">
            People are asking in these, but you&apos;re not a member. Join one, press &ldquo;I joined&rdquo;, and its posts
            come through from then on.
          </p>
          <GroupsToJoin groups={toJoin} />
        </Fold>
      )}

      <Fold title="Settings">
        <AgentSettingsForm settings={settings} owner={owner} />
      </Fold>

      <Fold title="Install the extension" note={`Version ${extension.version}`}>
        <a
          href="/downloads/js-post-finder.zip"
          download
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" />
          Download the extension
        </a>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Unzip it. You get a folder called js-post-finder.</li>
          <li>
            In Chrome, go to <code>chrome://extensions</code> and turn on Developer mode, top right.
          </li>
          <li>Press Load unpacked and pick the js-post-finder folder.</li>
          <li>Stay signed in to this app and to Facebook in that Chrome. It only reads while Chrome is open.</li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Updating: download again, unzip over the old folder, then press the reload arrow on the extension in{" "}
          <code>chrome://extensions</code>.
        </p>
      </Fold>
    </div>
  );
}

/** A section folded shut until somebody opens it. */
function Fold({ title, count, note, children }: { title: string; count?: number; note?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer list-none text-sm font-semibold">
        <span className="flex items-center justify-between gap-2">
          <span>
            {title}
            {count != null && <span className="ml-1 font-normal text-muted-foreground">({count})</span>}
            {note && <span className="ml-2 text-xs font-normal text-muted-foreground">{note}</span>}
          </span>
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** The last Reddit look in one line: when, what it kept, and what would not answer. */
function describeRedditLook(look: RedditLook): string {
  const kept = look.subreddits.reduce((n, s) => n + s.kept, 0);
  const matched = look.subreddits.reduce((n, s) => n + s.matched, 0);
  const read = look.subreddits.reduce((n, s) => n + s.read, 0);
  const failed = look.subreddits.filter((s) => !s.ok);
  return (
    `Last look ${shortWhen(look.at)}: read ${read} posts in ${look.subreddits.length} subreddit${look.subreddits.length === 1 ? "" : "s"}, ` +
    `${matched} mentioned the work, ${kept} new.` +
    (failed.length > 0 ? ` Couldn't read ${failed.map((s) => `r/${s.name}`).join(", ")}.` : "")
  );
}
