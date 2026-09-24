import { createClient } from "@/lib/supabase/server";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import {
  DEFAULT_SETTINGS,
  type AgentGroup,
  type AgentSettings,
  type AgentSources,
  type Decision,
  type ScanSource,
} from "@/lib/outreach-agent";

/**
 * The group agent's settings and its memory, read and written.
 *
 * One row of settings per business, made on first read so the page and the
 * browser never see a missing row. One row per post the agent has looked
 * at, so a post is decided about once.
 */

function groupsFrom(raw: unknown): AgentGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      const row = g as { url?: unknown; name?: unknown };
      const url = typeof row.url === "string" ? row.url : "";
      const name = typeof row.name === "string" ? row.name : "";
      return url ? { url, name } : null;
    })
    .filter((g): g is AgentGroup => g !== null);
}

function sourcesFrom(raw: unknown): AgentSources {
  const row = (raw ?? {}) as Partial<Record<keyof AgentSources, unknown>>;
  const on = (key: keyof AgentSources) => (typeof row[key] === "boolean" ? (row[key] as boolean) : DEFAULT_SETTINGS.sources[key]);
  return { feed: on("feed"), search: on("search"), list: on("list") };
}

export async function getAgentSettings(organizationId: string): Promise<AgentSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_agent_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    groups: groupsFrom(data.groups),
    sources: sourcesFrom(data.sources),
    searchPhrases: data.search_phrases ?? DEFAULT_SETTINGS.searchPhrases,
    areaWords: data.area_words ?? DEFAULT_SETTINGS.areaWords,
    keywords: data.keywords ?? DEFAULT_SETTINGS.keywords,
    dailyCap: data.daily_cap,
    hourlyCap: data.hourly_cap,
    activeFrom: data.active_from,
    activeTo: data.active_to,
    scanEveryMinutes: data.scan_every_minutes,
    maxAgeDays: data.max_age_days,
    autoPost: data.auto_post,
    pausedUntil: data.paused_until,
    pauseReason: data.pause_reason,
  };
}

export async function saveAgentSettings(
  organizationId: string,
  by: string,
  settings: Omit<AgentSettings, "pausedUntil" | "pauseReason">
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("outreach_agent_settings").upsert(
    {
      organization_id: organizationId,
      groups: settings.groups,
      sources: settings.sources,
      search_phrases: settings.searchPhrases,
      area_words: settings.areaWords,
      keywords: settings.keywords,
      daily_cap: settings.dailyCap,
      hourly_cap: settings.hourlyCap,
      active_from: settings.activeFrom,
      active_to: settings.activeTo,
      scan_every_minutes: settings.scanEveryMinutes,
      max_age_days: settings.maxAgeDays,
      auto_post: settings.autoPost,
      updated_at: new Date().toISOString(),
      updated_by: by,
    },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
}

/** Stop for a while, and say why. Null clears it. */
export async function pauseAgent(organizationId: string, by: string, until: Date | null, reason: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("outreach_agent_settings").upsert(
    {
      organization_id: organizationId,
      paused_until: until ? until.toISOString() : null,
      pause_reason: until ? reason : null,
      updated_at: new Date().toISOString(),
      updated_by: by,
    },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
}

export interface AgentCounts {
  postedToday: number;
  postedThisHour: number;
  queued: number;
}

/** What the agent has done today, for the caps. Today is the business's day. */
export async function agentCounts(organizationId: string, now: Date = new Date()): Promise<AgentCounts> {
  const supabase = await createClient();
  const startOfDay = startOfBusinessDay(now);
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [{ count: today }, { count: hour }, { count: queued }] = await Promise.all([
    supabase
      .from("outreach_links")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("via", "agent")
      .gte("posted_comment_at", startOfDay.toISOString()),
    supabase
      .from("outreach_links")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("via", "agent")
      .gte("posted_comment_at", hourAgo),
    supabase
      .from("outreach_seen_posts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("decision", "queued")
      .gte("created_at", new Date(now.getTime() - 6 * 3_600_000).toISOString()),
  ]);
  return { postedToday: today ?? 0, postedThisHour: hour ?? 0, queued: queued ?? 0 };
}

/** Midnight in the business's zone, as an instant. */
function startOfBusinessDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsedMs = ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000;
  return new Date(now.getTime() - elapsedMs);
}

/** Which of these post keys the agent has already decided about. */
export async function alreadySeen(organizationId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_seen_posts")
    .select("post_key")
    .eq("organization_id", organizationId)
    .in("post_key", keys);
  return new Set((data ?? []).map((row) => row.post_key));
}

export interface SeenInput {
  postKey: string;
  url: string;
  groupName: string | null;
  author: string | null;
  text: string | null;
  ageDays: number | null;
  decision: Decision;
  reason: string | null;
  linkId: string | null;
  source?: ScanSource;
  groupKey?: string | null;
}

/**
 * Write down a post and the decision. Returns the row's id, or null when
 * another request got there first: the unique key is what makes two
 * browsers scanning the same group safe.
 */
export async function recordSeen(organizationId: string, by: string, input: SeenInput): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_seen_posts")
    .insert({
      organization_id: organizationId,
      post_key: input.postKey,
      url: input.url,
      group_name: input.groupName,
      author: input.author,
      text: input.text?.slice(0, 4000) ?? null,
      age_days: input.ageDays,
      decision: input.decision,
      reason: input.reason,
      link_id: input.linkId,
      seen_by: by,
      source: input.source ?? "group",
      group_key: input.groupKey ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return null;
    throw error;
  }
  return data.id;
}

export async function updateSeen(
  organizationId: string,
  id: string,
  patch: { decision: Decision; reason?: string | null }
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_seen_posts")
    .update({ decision: patch.decision, reason: patch.reason ?? null, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw error;
}

export interface GroupRow {
  id: string;
  groupKey: string;
  url: string;
  name: string | null;
  joined: boolean;
  postsFound: number;
  lastPostAt: string | null;
  dismissedAt: string | null;
}

function groupRow(row: {
  id: string;
  group_key: string;
  url: string;
  name: string | null;
  joined: boolean;
  posts_found: number;
  last_post_at: string | null;
  dismissed_at: string | null;
}): GroupRow {
  return {
    id: row.id,
    groupKey: row.group_key,
    url: row.url,
    name: row.name,
    joined: row.joined,
    postsFound: row.posts_found,
    lastPostAt: row.last_post_at,
    dismissedAt: row.dismissed_at,
  };
}

/**
 * Write down a group the agent has seen, and what it saw there.
 *
 * Joined is one-way: a group seen in the account's own feed, or one a
 * comment went up in, stays joined. A lead counted here is one more reason
 * to join a group the account is not in.
 */
export async function noteGroup(
  organizationId: string,
  input: { groupKey: string; url: string; name: string | null; joined?: boolean; foundPost?: boolean }
): Promise<void> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("outreach_groups")
    .select("id, joined, posts_found, name")
    .eq("organization_id", organizationId)
    .eq("group_key", input.groupKey)
    .maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    const patch: { updated_at: string; joined?: boolean; name?: string; posts_found?: number; last_post_at?: string } = { updated_at: now };
    if (input.joined && !existing.joined) patch.joined = true;
    if (input.name && !existing.name) patch.name = input.name;
    if (input.foundPost) {
      patch.posts_found = existing.posts_found + 1;
      patch.last_post_at = now;
    }
    await supabase.from("outreach_groups").update(patch).eq("id", existing.id);
    return;
  }
  await supabase.from("outreach_groups").insert({
    organization_id: organizationId,
    group_key: input.groupKey,
    url: input.url,
    name: input.name,
    joined: Boolean(input.joined),
    posts_found: input.foundPost ? 1 : 0,
    last_post_at: input.foundPost ? now : null,
  });
}

/** The groups the account is known to be in. */
export async function joinedGroupKeys(organizationId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("outreach_groups").select("group_key").eq("organization_id", organizationId).eq("joined", true);
  return new Set((data ?? []).map((row) => row.group_key));
}

/** Groups seen with leads in them that the account has not joined, most leads first. */
export async function groupsToJoin(organizationId: string): Promise<GroupRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_groups")
    .select("id, group_key, url, name, joined, posts_found, last_post_at, dismissed_at")
    .eq("organization_id", organizationId)
    .eq("joined", false)
    .is("dismissed_at", null)
    .order("posts_found", { ascending: false })
    .order("last_post_at", { ascending: false })
    .limit(100);
  return (data ?? []).map(groupRow);
}

export async function setGroupJoined(organizationId: string, id: string, joined: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_groups")
    .update({ joined, dismissed_at: null, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw error;
}

export async function dismissGroup(organizationId: string, id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_groups")
    .update({ dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw error;
}

export interface SeenRow {
  id: string;
  url: string;
  groupName: string | null;
  author: string | null;
  text: string | null;
  ageDays: number | null;
  decision: Decision;
  reason: string | null;
  linkId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The comment that was written, when one was. */
  comment: string | null;
  code: string | null;
  clicks: number;
}

/** What the agent has looked at lately, newest first. */
export async function recentAgentActivity(organizationId: string, limit = 60): Promise<SeenRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_seen_posts")
    .select("id, url, group_name, author, text, age_days, decision, reason, link_id, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  const linkIds = rows.map((row) => row.link_id).filter((id): id is string => Boolean(id));
  const links = new Map<string, { comment: string | null; code: string; clicks: number }>();
  if (linkIds.length > 0) {
    const { data: linkRows } = await supabase
      .from("outreach_links")
      .select("id, code, comment, posted_comment, click_count")
      .in("id", linkIds);
    for (const link of linkRows ?? []) {
      links.set(link.id, { comment: link.posted_comment ?? link.comment, code: link.code, clicks: link.click_count });
    }
  }
  return rows.map((row) => {
    const link = row.link_id ? links.get(row.link_id) : undefined;
    return {
      id: row.id,
      url: row.url,
      groupName: row.group_name,
      author: row.author,
      text: row.text,
      ageDays: row.age_days,
      decision: row.decision as Decision,
      reason: row.reason,
      linkId: row.link_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      comment: link?.comment ?? null,
      code: link?.code ?? null,
      clicks: link?.clicks ?? 0,
    };
  });
}
