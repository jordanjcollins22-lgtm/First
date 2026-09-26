import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TIME_ZONE, dateKeyIn, zonedToUtc } from "@/lib/time-zone";
import { findPostUrl } from "@/lib/outreach-agent";
import type { Platform } from "@/lib/social-finder";
import {
  BOARD_MAX_AGE_DAYS,
  ageNow,
  isPostLink,
  standingFor,
  stillFresh,
  type AnswerStatus,
  type BoardAnswer,
  type BoardPile,
} from "@/lib/post-board";

/**
 * The Posts to answer board: every post the browser found of somebody
 * asking for the work, still fresh, with who has taken it.
 *
 * Reads only. Taking a post, and saying it is posted, are in the actions.
 */

export interface BoardPost {
  id: string;
  /** The post's own address, or a Facebook search for its words when it had none. */
  link: string;
  hasUrl: boolean;
  groupName: string | null;
  author: string | null;
  text: string;
  ageDays: number;
  foundAt: string;
  pile: BoardPile;
  mine: BoardAnswer | null;
  /** Everybody else holding a place on it: posted, or writing right now. */
  others: BoardAnswer[];
  platform: Platform;
  /** When it went up, where the platform said. */
  postedAt: string | null;
  /** Why the finder kept it. */
  matchReason: string | null;
  /** Somebody on the team added it rather than the finder. */
  addedByHand: boolean;
}

/** Midnight this morning, the business's time. */
export function startOfToday(now: Date): Date {
  return zonedToUtc(dateKeyIn(now, BUSINESS_TIME_ZONE), "00:00", BUSINESS_TIME_ZONE);
}

async function freshRequests(organizationId: string, now: Date) {
  const supabase = await createClient();
  // A post read up to the age limit ago may already have been that old
  // when it was read; the exact test is done after.
  const since = new Date(now.getTime() - BOARD_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("outreach_seen_posts")
    .select("id, url, group_name, author, text, age_days, created_at, platform, posted_at, match_reason, added_by")
    .eq("organization_id", organizationId)
    .eq("kind", "request")
    .eq("decision", "read")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).filter((row) => stillFresh(ageWhenRead(row), row.created_at, now));
}

/** How old the post was when it was read: from when it went up where known. */
function ageWhenRead(row: { age_days: number | null; posted_at: string | null; created_at: string }): number | null {
  if (row.posted_at) return Math.max(0, Math.floor((new Date(row.created_at).getTime() - new Date(row.posted_at).getTime()) / 86_400_000));
  return row.age_days;
}

async function answersFor(organizationId: string, postIds: string[]): Promise<Map<string, BoardAnswer[]>> {
  const byPost = new Map<string, BoardAnswer[]>();
  if (postIds.length === 0) return byPost;
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("outreach_post_answers")
    .select("id, seen_post_id, profile_id, link_id, comment, status, posted_at, created_at, updated_at")
    .eq("organization_id", organizationId)
    .in("seen_post_id", postIds);
  if (error) throw error;
  const answers = rows ?? [];

  const profileIds = Array.from(new Set(answers.map((a) => a.profile_id)));
  const linkIds = answers.map((a) => a.link_id).filter((id): id is string => Boolean(id));
  const [{ data: people }, { data: links }] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    linkIds.length > 0
      ? supabase.from("outreach_links").select("id, code, click_count").in("id", linkIds)
      : Promise.resolve({ data: [] as { id: string; code: string; click_count: number }[] }),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id, (p.full_name || p.email || "Somebody").split(" ")[0]]));
  const linkById = new Map((links ?? []).map((l) => [l.id, l]));

  for (const a of answers) {
    const link = a.link_id ? linkById.get(a.link_id) : undefined;
    const list = byPost.get(a.seen_post_id) ?? [];
    list.push({
      id: a.id,
      profileId: a.profile_id,
      name: names.get(a.profile_id) ?? "Somebody",
      status: a.status as AnswerStatus,
      comment: a.comment,
      code: link?.code ?? null,
      clicks: link?.click_count ?? 0,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      postedAt: a.posted_at,
    });
    byPost.set(a.seen_post_id, list);
  }
  return byPost;
}

/** The board as one person sees it, newest first. */
export async function getPostBoard(organizationId: string, profileId: string, now: Date = new Date()): Promise<BoardPost[]> {
  const posts = await freshRequests(organizationId, now);
  const answers = await answersFor(organizationId, posts.map((p) => p.id));
  // Only posts that can be opened. One without a working link stays off the
  // board until the finder brings its link back, unless somebody already
  // took it, who still needs to see what they took.
  // A post somebody added by hand shows too, link or not: a person looked at
  // it and said it is worth answering.
  const shown = posts.filter(
    (row) => isPostLink(row.url) || Boolean(row.added_by) || (answers.get(row.id) ?? []).some((a) => a.status !== "let_go")
  );
  return shown.map((row) => {
    const list = answers.get(row.id) ?? [];
    const standing = standingFor(list, profileId, now);
    const text = row.text ?? "";
    return {
      id: row.id,
      link: isPostLink(row.url) ? row.url : findPostUrl(text),
      hasUrl: isPostLink(row.url),
      groupName: row.group_name,
      author: row.author,
      text,
      ageDays: ageNow(ageWhenRead(row), row.created_at, now),
      platform: (row.platform ?? "facebook") as Platform,
      postedAt: row.posted_at,
      matchReason: row.match_reason,
      addedByHand: Boolean(row.added_by),
      foundAt: row.created_at,
      pile: standing.pile,
      mine: standing.mine,
      others: standing.others,
    };
  });
}

/**
 * How many fresh posts nobody on the team has taken yet. For My Day and the
 * extension: a post with one answer already has somebody on it, so the
 * number that needs saying is the ones with none.
 */
export async function countOpenPosts(organizationId: string, now: Date = new Date()): Promise<number> {
  const posts = await freshRequests(organizationId, now);
  const answers = await answersFor(organizationId, posts.map((p) => p.id));
  return posts.filter((p) => (isPostLink(p.url) || Boolean(p.added_by)) && standingFor(answers.get(p.id) ?? [], "", now).others.length === 0).length;
}

/** How many one person has taken today, not counting any they handed back. */
export async function answeredToday(organizationId: string, profileId: string, now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("outreach_post_answers")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .neq("status", "let_go")
    .gte("created_at", startOfToday(now).toISOString());
  return count ?? 0;
}

/** Every answer to one post, for deciding whether somebody may take it. */
export async function answersToPost(organizationId: string, postId: string): Promise<BoardAnswer[]> {
  return (await answersFor(organizationId, [postId])).get(postId) ?? [];
}

export interface AnswererStanding {
  profileId: string;
  name: string;
  /** Comments posted in the last seven days. */
  week: number;
  allTime: number;
  /** Opens of the links in their comments. */
  clicks: number;
  /** Evaluations booked through those links. */
  booked: number;
  /** Posts they found themselves and added. */
  found: number;
}

/**
 * Who is answering posts, best first.
 *
 * Counted from what happened, not from what anybody typed: comments marked
 * posted, the opens their links got, the evaluations booked through them,
 * and the posts they found and added. Names and counts only, so it is the
 * same board on everybody's screen.
 */
export async function answeringLeaderboard(organizationId: string, now: Date = new Date()): Promise<AnswererStanding[]> {
  // Read with the service client, scoped to the business by hand: an
  // affiliate may not see other people's links or jobs, and the board has to
  // read the same on every screen. Only names and counts leave here.
  const supabase = createAdminClient();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: answers }, { data: added }] = await Promise.all([
    supabase
      .from("outreach_post_answers")
      .select("profile_id, link_id, posted_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .limit(5000),
    supabase.from("outreach_seen_posts").select("added_by").eq("organization_id", organizationId).not("added_by", "is", null).limit(5000),
  ]);
  const rows = answers ?? [];
  const linkIds = rows.map((r) => r.link_id).filter((id): id is string => Boolean(id));
  const { data: links } = linkIds.length
    ? await supabase.from("outreach_links").select("id, code, click_count").eq("organization_id", organizationId).in("id", linkIds)
    : { data: [] as { id: string; code: string; click_count: number }[] };
  const codes = (links ?? []).map((l) => l.code);
  const { data: jobs } = codes.length
    ? // The codes are this business's own links, so the jobs they booked are its own.
      await supabase.from("jobs").select("referral_code").in("referral_code", codes)
    : { data: [] as { referral_code: string | null }[] };
  const linkById = new Map((links ?? []).map((l) => [l.id, l]));
  const bookedCodes = new Map<string, number>();
  for (const job of jobs ?? []) {
    if (job.referral_code) bookedCodes.set(job.referral_code, (bookedCodes.get(job.referral_code) ?? 0) + 1);
  }

  const by = new Map<string, AnswererStanding>();
  const get = (id: string) => {
    let s = by.get(id);
    if (!s) {
      s = { profileId: id, name: "", week: 0, allTime: 0, clicks: 0, booked: 0, found: 0 };
      by.set(id, s);
    }
    return s;
  };
  for (const r of rows) {
    const s = get(r.profile_id);
    s.allTime += 1;
    if (r.posted_at && r.posted_at >= weekAgo) s.week += 1;
    const link = r.link_id ? linkById.get(r.link_id) : undefined;
    if (link) {
      s.clicks += link.click_count ?? 0;
      s.booked += bookedCodes.get(link.code) ?? 0;
    }
  }
  for (const r of added ?? []) if (r.added_by) get(r.added_by).found += 1;

  const ids = [...by.keys()];
  if (ids.length === 0) return [];
  const { data: people } = await supabase.from("profiles").select("id, full_name, email").eq("organization_id", organizationId).in("id", ids);
  for (const p of people ?? []) {
    const s = by.get(p.id);
    if (s) s.name = (p.full_name || p.email || "Somebody").split(" ")[0];
  }
  return [...by.values()]
    .map((s) => ({ ...s, name: s.name || "Somebody" }))
    .sort((a, b) => b.booked - a.booked || b.week - a.week || b.allTime - a.allTime || b.found - a.found);
}
