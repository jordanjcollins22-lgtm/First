import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  tallyGroups,
  urgencyRank,
  type GroupPlatform,
  type GroupTally,
  type PassStatus,
  type PostKind,
  type Urgency,
} from "@/lib/community-groups";

/**
 * The groups this business runs, what got posted in them, and who paid.
 *
 * One screen's worth. Nothing here talks to Facebook, because since April 2024
 * there is nothing to talk to — a group feed cannot be read by any app, so
 * every post in these tables got here because a person pasted it or
 * photographed it.
 */

export interface GroupRow {
  id: string;
  name: string;
  area: string | null;
  platform: GroupPlatform;
  externalUrl: string | null;
  memberCount: number | null;
  businessPostCents: number | null;
  passDays: number;
  declineMessage: string | null;
  blockWords: string[];
  archivedAt: string | null;
  tally: GroupTally;
}

export interface PostRow {
  id: string;
  groupId: string;
  groupName: string;
  kind: PostKind;
  service: string | null;
  urgency: Urgency | null;
  authorName: string | null;
  summary: string | null;
  matchedWords: string[];
  postedText: string | null;
  screenshotPath: string | null;
  handledAt: string | null;
  handledNote: string | null;
  postedAt: string;
}

export interface PassRow {
  id: string;
  groupId: string;
  groupName: string;
  businessName: string;
  email: string | null;
  code: string;
  amountCents: number;
  status: PassStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface GroupBoard {
  groups: GroupRow[];
  /** Requests nobody has answered, soonest-needed first. The work list. */
  open: PostRow[];
  recent: PostRow[];
  passes: PassRow[];
  /** The business's own service names, for sorting a request into one. */
  services: string[];
}

const POST_PAGE = 200;
const PASS_PAGE = 100;

export async function getGroupBoard(): Promise<GroupBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data: groupData } = await supabase
    .from("community_groups")
    .select(
      "id, name, area, platform, external_url, member_count, business_post_cents, pass_days, decline_message, block_words, archived_at"
    )
    .eq("organization_id", organizationId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");

  const groups = groupData ?? [];
  const nameOf = new Map(groups.map((group) => [group.id, group.name]));

  const [{ data: postData }, { data: passData }, { data: serviceData }] = await Promise.all([
    supabase
      .from("community_group_posts")
      .select(
        "id, group_id, kind, service, urgency, author_name, summary, matched_words, posted_text, screenshot_path, handled_at, handled_note, posted_at"
      )
      .eq("organization_id", organizationId)
      .order("posted_at", { ascending: false })
      .limit(POST_PAGE),
    supabase
      .from("group_post_passes")
      .select("id, group_id, business_name, email, code, amount_cents, status, expires_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(PASS_PAGE),
    supabase
      .from("services")
      .select("name")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("name"),
  ]);

  const posts: PostRow[] = (postData ?? []).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    groupName: nameOf.get(row.group_id) ?? "A group",
    kind: row.kind as PostKind,
    service: row.service,
    urgency: (row.urgency as Urgency | null) ?? null,
    authorName: row.author_name,
    summary: row.summary,
    matchedWords: row.matched_words ?? [],
    postedText: row.posted_text,
    screenshotPath: row.screenshot_path,
    handledAt: row.handled_at,
    handledNote: row.handled_note,
    postedAt: row.posted_at,
  }));

  const passes: PassRow[] = (passData ?? []).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    groupName: nameOf.get(row.group_id) ?? "A group",
    businessName: row.business_name,
    email: row.email,
    code: row.code,
    amountCents: row.amount_cents,
    status: row.status as PassStatus,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));

  const tallies = tallyGroups(
    posts.map((post) => ({ groupId: post.groupId, kind: post.kind, handledAt: post.handledAt })),
    passes.map((pass) => ({ groupId: pass.groupId, status: pass.status, amountCents: pass.amountCents }))
  );

  const empty: GroupTally = {
    groupId: "",
    requests: 0,
    promotions: 0,
    other: 0,
    unanswered: 0,
    earnedCents: 0,
  };

  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      area: group.area,
      platform: group.platform as GroupPlatform,
      externalUrl: group.external_url,
      memberCount: group.member_count,
      businessPostCents: group.business_post_cents,
      passDays: group.pass_days,
      declineMessage: group.decline_message,
      blockWords: group.block_words ?? [],
      archivedAt: group.archived_at,
      tally: tallies.get(group.id) ?? { ...empty, groupId: group.id },
    })),
    // Soonest-needed first, then oldest, because a request from Tuesday that
    // nobody answered is more urgent than one from an hour ago.
    open: posts
      .filter((post) => post.kind === "request" && !post.handledAt)
      .sort(
        (a, b) =>
          urgencyRank(a.urgency) - urgencyRank(b.urgency) ||
          a.postedAt.localeCompare(b.postedAt)
      ),
    recent: posts.slice(0, 40),
    passes,
    services: (serviceData ?? []).map((row) => row.name).filter(Boolean),
  };
}

/** One group, by id, for the public pay-to-post page. */
export async function groupPassTerms(groupId: string): Promise<{
  id: string;
  organizationId: string;
  name: string;
  area: string | null;
  businessPostCents: number | null;
  passDays: number;
  memberCount: number | null;
} | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data } = await admin
    .from("community_groups")
    .select("id, organization_id, name, area, business_post_cents, pass_days, member_count, archived_at")
    .eq("id", groupId)
    .maybeSingle();

  if (!data || data.archived_at) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    name: data.name,
    area: data.area,
    businessPostCents: data.business_post_cents,
    passDays: data.pass_days,
    memberCount: data.member_count,
  };
}
