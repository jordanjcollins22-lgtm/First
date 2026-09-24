import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { getAgentSettings, recordSeen } from "@/lib/data/outreach-agent";
import {
  ageDaysFromLabel,
  cleanPostText,
  cleanPostUrl,
  groupKeyFrom,
  isAnonymousAuthor,
  matchesKeywords,
  postKeyFrom,
  textKeyFor,
  type ScanSource,
} from "@/lib/outreach-agent";
import { createClient } from "@/lib/supabase/server";
import { sortReadPosts } from "@/lib/data/post-sorter";

/**
 * The posts the browser found.
 *
 * The browser sends every post on a page: the account's own groups feed, a
 * search for a phrase, or one listed group. Each new one is written down,
 * sorted into asking-for-work, advertising or neither, and the ones asking
 * go on the team's Posts to answer board. Nothing is answered from here and
 * nothing is posted by the browser: one account posting under every lead
 * in the county is how an account gets banned, so the finding is done here
 * and the answering is spread across the team, each from their own account.
 *
 * What the page looked like is kept too, so a scanner that has stopped
 * seeing posts can be diagnosed from the app.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface IncomingPost {
  /** Null when the page showed the post without a link to it. */
  url: string | null;
  text: string;
  author?: string | null;
  anonymous?: boolean;
  ageLabel?: string | null;
  group?: { url?: string | null; name?: string | null } | null;
}

const SOURCES: ScanSource[] = ["feed", "search", "group"];

/** The browser's account of one look, with only the fields we keep, each bounded. */
function lookFrom(raw: { name?: unknown; source?: unknown; stats?: unknown; version?: unknown }, sent: number) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100_000, Math.round(v))) : null);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const stats = (raw.stats && typeof raw.stats === "object" ? raw.stats : {}) as Record<string, unknown>;
  const samples = Array.isArray(stats.samples) ? stats.samples.slice(0, 8) : [];
  return {
    name: str(raw.name, 120),
    source: str(raw.source, 20),
    version: str(raw.version, 20),
    title: str(stats.title, 80),
    posts: num(stats.posts),
    mentioned: num(stats.mentioned),
    mentionedNoLink: num(stats.mentionedNoLink),
    withLink: num(stats.withLink),
    textChars: num(stats.textChars),
    sent,
    samples: samples.map((s) => {
      const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { text: str(row.text, 120), link: row.link === true, matched: row.matched === true };
    }),
  };
}

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: {
    source?: string;
    phrase?: string;
    groupUrl?: string;
    groupName?: string;
    posts?: IncomingPost[];
    look?: { name?: unknown; source?: unknown; stats?: unknown; version?: unknown } | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const source: ScanSource = SOURCES.includes(body.source as ScanSource) ? (body.source as ScanSource) : "group";
  const listedGroupName = (body.groupName ?? "").trim().slice(0, 120);
  const listedGroupKey = source === "group" ? groupKeyFrom(body.groupUrl) : null;
  const posts = Array.isArray(body.posts) ? body.posts.slice(0, 40) : [];

  const now = new Date();
  const settings = await getAgentSettings(profile.organization_id);

  // What the page looked like, kept whether or not anything matched, so a
  // scanner that has stopped seeing posts shows up here and not only in a
  // popup on one computer. Trimmed: this is a diagnosis, not an archive.
  if (body.look && typeof body.look === "object") {
    await (await createClient())
      .from("outreach_agent_settings")
      .update({ last_look: lookFrom(body.look, posts.length), last_look_at: now.toISOString() })
      .eq("organization_id", profile.organization_id);
  }

  // Every post read is kept, link or no link, words or no words, and put
  // on the team's board once sorted. Nothing is written here: a comment is
  // written for one person when that person asks for it, with their own
  // link, and they post it from their own account.
  let kept = 0;
  let skipped = 0;
  for (const post of posts) {
    const text = cleanPostText(post.text ?? "").slice(0, 4000);
    if (text.length < 12) continue;
    const url = typeof post.url === "string" && /^https:\/\/(www\.|m\.)?facebook\.com\//.test(post.url) ? cleanPostUrl(post.url) : "";
    const groupKey = groupKeyFrom(post.group?.url) ?? (url ? groupKeyFrom(url) : null) ?? listedGroupKey;
    const textKey = textKeyFor(text, groupKey);
    // A link copied from the Share menu is a short link that differs from
    // the post's own; the post is keyed on its words instead, so the same
    // post read twice is still one row.
    const isShareLink = /facebook\.com\/share\//i.test(url);
    const key = (url && !isShareLink ? postKeyFrom(url) : null) ?? textKey;
    // Read before without a link: this time there is one, so the row it
    // already has gets it rather than a second row being made.
    if (url) {
      const { data: earlier } = await (await createClient())
        .from("outreach_seen_posts")
        .select("id, url")
        .eq("organization_id", profile.organization_id)
        .eq("post_key", textKey)
        .maybeSingle();
      if (earlier) {
        if (!earlier.url) {
          await (await createClient()).from("outreach_seen_posts").update({ url, updated_at: now.toISOString() }).eq("id", earlier.id);
        }
        skipped += 1;
        continue;
      }
    }
    const anonymous = post.anonymous === true || isAnonymousAuthor(post.author);
    const matched = matchesKeywords(text, settings.keywords);
    const id = await recordSeen(profile.organization_id, profile.id, {
      postKey: key,
      url,
      groupName: (post.group?.name ?? "").trim().slice(0, 120) || listedGroupName || null,
      author: anonymous ? null : post.author?.trim().slice(0, 80) || null,
      text,
      ageDays: ageDaysFromLabel(post.ageLabel, now),
      decision: "read",
      reason: null,
      linkId: null,
      source,
      groupKey,
      matched,
    });
    if (id) kept += 1;
    else skipped += 1;
  }
  // Sorted before the answer goes back: who wants work done, who is
  // selling it, and the businesses among the second kept. Anything left
  // unsorted from before is swept up in the same call.
  const sort = kept > 0 ? await sortReadPosts(profile.organization_id, { limit: 40 }) : { sorted: 0, businesses: 0 };
  return NextResponse.json({ ok: true, actions: [], decided: [], kept, skipped, sorted: sort.sorted, businesses: sort.businesses, moreToRead: false });
}
