import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { recordSeen } from "@/lib/data/outreach-agent";
import { sortReadPosts } from "@/lib/data/post-sorter";
import { cleanSubreddit, matchReason, parseRedditListing, redditNewPath, subredditIsLocal, type FoundPost } from "@/lib/social-finder";
import type { AgentSettings } from "@/lib/outreach-agent";

/**
 * Reddit, read on the server's timer.
 *
 * Each listed subreddit's newest posts are read, matched against the work
 * words, and the ones that match are kept, once each, as posts to sort. It
 * reads and it keeps; it never posts, votes or messages, so there is nothing
 * it can do on Reddit that anybody would notice. A subreddit that will not
 * answer is written down and skipped, never retried in a loop: the next run
 * is half an hour away.
 */

/** Older than this and the neighbour has found somebody. */
const MAX_AGE_DAYS = 14;
const USER_AGENT = "web:jslandscapingmd-post-finder:1.0 (reads public posts; contact via jslandscapingmd.com)";

export interface SubredditLook {
  name: string;
  ok: boolean;
  status: number | null;
  read: number;
  matched: number;
  kept: number;
  error?: string;
}

export interface RedditLook {
  at: string;
  via: "oauth" | "public";
  subreddits: SubredditLook[];
  sorted: number;
}

type Admin = ReturnType<typeof createAdminClient>;

/** An app-only token, when the business has a Reddit app of its own. */
async function appToken(): Promise<string | null> {
  if (!env.redditClientId || !env.redditClientSecret) return null;
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.redditClientId}:${env.redditClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

async function readSubreddit(name: string, token: string | null): Promise<{ status: number | null; posts: FoundPost[]; error?: string }> {
  const url = token ? `https://oauth.reddit.com${redditNewPath(name).replace(".json", "")}` : `https://www.reddit.com${redditNewPath(name)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: res.status, posts: [], error: `Reddit answered ${res.status}` };
    return { status: res.status, posts: parseRedditListing(await res.json()) };
  } catch (err) {
    return { status: null, posts: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** One run for one business. Never throws: a bad run is a look with errors in it. */
export async function runRedditFinder(organizationId: string, settings: AgentSettings, admin: Admin, now: Date = new Date()): Promise<RedditLook> {
  const token = await appToken();
  const look: RedditLook = { at: now.toISOString(), via: token ? "oauth" : "public", subreddits: [], sorted: 0 };
  const names = settings.redditSubreddits.map(cleanSubreddit).filter((n): n is string => Boolean(n));
  let keptAny = false;

  for (const name of names) {
    const read = await readSubreddit(name, token);
    const entry: SubredditLook = { name, ok: !read.error, status: read.status, read: read.posts.length, matched: 0, kept: 0, error: read.error };
    const local = subredditIsLocal(name, settings.areaWords);
    for (const post of read.posts) {
      if (post.postedAt && now.getTime() - post.postedAt.getTime() > MAX_AGE_DAYS * 86_400_000) continue;
      const verdict = matchReason({ text: post.text, keywords: settings.keywords, areaWords: settings.areaWords, needArea: !local });
      if (!verdict.matched) continue;
      entry.matched += 1;
      try {
        const id = await recordSeen(
          organizationId,
          null,
          {
            postKey: post.key,
            url: post.url,
            groupName: post.where,
            author: post.author,
            text: post.text,
            ageDays: post.postedAt ? Math.floor((now.getTime() - post.postedAt.getTime()) / 86_400_000) : null,
            decision: "read",
            reason: null,
            linkId: null,
            source: "group",
            groupKey: `reddit:${name.toLowerCase()}`,
            matched: true,
            platform: "reddit",
            postedAt: post.postedAt,
            matchReason: verdict.reason,
          },
          admin
        );
        // Null is the unique key saying this one is already kept.
        if (id) {
          entry.kept += 1;
          keptAny = true;
        }
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
    look.subreddits.push(entry);
  }

  if (keptAny) {
    const sort = await sortReadPosts(organizationId, { limit: 40, client: admin }).catch(() => ({ sorted: 0, businesses: 0 }));
    look.sorted = sort.sorted;
  }

  await admin
    .from("outreach_agent_settings")
    .update({ last_reddit_look: look, last_reddit_look_at: look.at })
    .eq("organization_id", organizationId);
  log.info("finder.reddit", {
    organizationId,
    via: look.via,
    kept: look.subreddits.reduce((n, s) => n + s.kept, 0),
    failed: look.subreddits.filter((s) => !s.ok).map((s) => s.name),
  });
  return look;
}
