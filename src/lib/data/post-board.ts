import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rankClosers, stageOf, type CloserStanding, type PostStage, type SoldJobInput } from "@/lib/affiliate-closes";
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

/**
 * The affiliate leaderboard: everybody who has put affiliate links out, and
 * what those links brought in and closed. Work that came in any other way
 * is not counted, and nobody who has not put a link out is listed. Read
 * with the service client and scoped to the business by hand, because an
 * affiliate cannot see other people's jobs and the board has to read the
 * same on every screen.
 */
export async function affiliateClosedBoard(organizationId: string, now: Date = new Date()): Promise<CloserStanding[]> {
  const admin = createAdminClient();
  const [
    { data: profiles, error: profilesError },
    all,
    { data: links, error: linksError },
    { data: answers },
  ] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
    orgJobs(organizationId),
    admin.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId).limit(10000),
    admin.from("outreach_post_answers").select("profile_id").eq("organization_id", organizationId).eq("status", "posted").limit(10000),
  ]);

  // A query that fails throws, so the page says the board didn't load
  // rather than showing an empty one.
  const failed = profilesError ?? linksError;
  if (failed) throw new Error(failed.message);

  const posterByCode = new Map((links ?? []).map((l) => [l.code, l.profile_id]));
  const linksOut = new Map<string, number>();
  for (const l of links ?? []) linksOut.set(l.profile_id, (linksOut.get(l.profile_id) ?? 0) + 1);
  const comments = new Map<string, number>();
  for (const a of answers ?? []) comments.set(a.profile_id, (comments.get(a.profile_id) ?? 0) + 1);

  const people = (profiles ?? []).map((p) => ({
    id: p.id,
    // First name, or the front of their email when no name is set.
    name: ((p.full_name?.trim().split(/\s+/)[0] || p.email?.split("@")[0] || "Somebody") as string).replace(/^\w/, (c) => c.toUpperCase()),
  }));
  return rankClosers(people, all, posterByCode, linksOut, comments, now);
}

type LinkedJob = SoldJobInput & { proposalStatus: string | null; proposalTotal: number | null; customerFirstName: string | null };

/**
 * Every job in the business that came in through a link, in the shape the
 * leaderboard and the answered-posts list read. The service client, scoped
 * to the business by hand: an affiliate cannot read jobs themselves.
 */
async function orgJobs(organizationId: string): Promise<LinkedJob[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .select(
      "id, status, declined_at, referral_code, referred_by_profile_id, assigned_to, project_start_date, " +
        "property:properties!inner(customer:customers!inner(organization_id, account_manager_id, name)), job_proposals(status, total_cost, responded_at)"
    )
    .or("referral_code.not.is.null,referred_by_profile_id.not.is.null")
    .limit(5000);
  if (error) throw new Error(error.message);

  type ProposalRow = { status: string; total_cost: number | string | null; responded_at: string | null };
  type JobRow = {
    id: string;
    status: string;
    declined_at: string | null;
    referral_code: string | null;
    referred_by_profile_id: string | null;
    assigned_to: string | null;
    project_start_date: string | null;
    property: { customer: { organization_id: string; account_manager_id: string | null; name: string | null } | null } | null;
    // A job has one proposal, so the database hands it back as one row
    // rather than a list; take either.
    job_proposals: ProposalRow[] | ProposalRow | null;
  };
  return ((data ?? []) as unknown as JobRow[])
    .filter((j) => j.property?.customer?.organization_id === organizationId)
    .map((j) => {
      const proposals = j.job_proposals == null ? [] : Array.isArray(j.job_proposals) ? j.job_proposals : [j.job_proposals];
      const accepted = proposals.filter((p) => p.status === "accepted");
      const best = accepted.sort((a, b) => Number(b.total_cost ?? 0) - Number(a.total_cost ?? 0))[0];
      const latest = proposals[0] ?? null;
      return {
        id: j.id,
        status: j.status,
        declined: Boolean(j.declined_at),
        soldFor: best?.total_cost != null ? Number(best.total_cost) : null,
        proposalAccepted: Boolean(best),
        referralCode: j.referral_code,
        referredBy: j.referred_by_profile_id,
        assignedTo: j.assigned_to,
        accountManager: j.property?.customer?.account_manager_id ?? null,
        closedAt: best?.responded_at ?? j.project_start_date,
        proposalStatus: best ? "accepted" : latest?.status ?? null,
        proposalTotal: (best ?? latest)?.total_cost != null ? Number((best ?? latest)!.total_cost) : null,
        customerFirstName: j.property?.customer?.name?.trim().split(/\s+/)[0] || null,
      };
    });
}

export interface AnsweredPost {
  /** The link's id, or the job's for one booked through a personal booking link. */
  id: string;
  /** What the post asked for, as it was noted when the link was made. */
  about: string;
  kind: string;
  platform: string;
  /** The post itself, where it is known. */
  postUrl: string | null;
  comment: string | null;
  answeredAt: string;
  clicks: number;
  stage: PostStage;
  /** The proposal's total, once there is one. */
  amount: number | null;
  /** The client's first name, once they have booked. */
  client: string | null;
}

/**
 * Everything one person has answered with a link, newest first, and where
 * each has got to: clicked, booked an evaluation, got a proposal, bought or
 * said no. Jobs booked through their personal booking link are on it too,
 * since the leaderboard credits those to them.
 */
export async function answeredPostsFor(organizationId: string, profileId: string): Promise<AnsweredPost[]> {
  const admin = createAdminClient();
  const [{ data: links, error: linksError }, jobs, { data: answers }] = await Promise.all([
    admin
      .from("outreach_links")
      .select("id, code, kind, platform, note, comment, posted_comment, post_url, click_count, created_at")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(1000),
    orgJobs(organizationId),
    admin
      .from("outreach_post_answers")
      .select("link_id, seen:outreach_seen_posts(url)")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .not("link_id", "is", null),
  ]);
  if (linksError) throw new Error(linksError.message);

  const jobByCode = new Map<string, LinkedJob>();
  for (const j of jobs) if (j.referralCode && !jobByCode.has(j.referralCode)) jobByCode.set(j.referralCode, j);
  type AnswerRow = { link_id: string; seen: { url: string | null } | { url: string | null }[] | null };
  const urlByLink = new Map<string, string>();
  for (const a of (answers ?? []) as unknown as AnswerRow[]) {
    const seen = Array.isArray(a.seen) ? a.seen[0] : a.seen;
    if (seen?.url && isPostLink(seen.url)) urlByLink.set(a.link_id, seen.url);
  }

  const codes = new Set<string>();
  const rows: AnsweredPost[] = (links ?? []).map((l) => {
    codes.add(l.code);
    const job = jobByCode.get(l.code) ?? null;
    const url = l.post_url && isPostLink(l.post_url) ? l.post_url : urlByLink.get(l.id) ?? null;
    return {
      id: l.id,
      about: (l.note ?? "").trim() || "A post",
      kind: l.kind,
      platform: l.platform,
      postUrl: url,
      comment: l.posted_comment ?? l.comment,
      answeredAt: l.created_at,
      clicks: l.click_count ?? 0,
      stage: stageOf(job, l.click_count ?? 0),
      amount: job?.proposalTotal ?? null,
      client: job?.customerFirstName ?? null,
    };
  });

  // Booked through their own booking link rather than a tracked one.
  for (const j of jobs) {
    if (j.referredBy !== profileId || (j.referralCode && codes.has(j.referralCode))) continue;
    rows.push({
      id: j.id,
      about: "Booked through your booking link",
      kind: "booking",
      platform: "other",
      postUrl: null,
      comment: null,
      answeredAt: j.closedAt ?? "",
      clicks: 0,
      stage: stageOf(j, 0),
      amount: j.proposalTotal,
      client: j.customerFirstName,
    });
  }
  return rows;
}
