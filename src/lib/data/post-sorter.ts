import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import {
  SORT_SYSTEM_PROMPT,
  SortResultSchema,
  businessKey,
  matchSorted,
  sortBrief,
  tidyBusiness,
  type BusinessDetails,
  type PostKind,
  type PostToSort,
} from "@/lib/post-sorting";

/**
 * Sort the posts waiting in the pile, and keep the businesses among them.
 *
 * One model call per batch. A request stays in the pile, marked; a
 * promotion leaves it, and the business behind it is written down or, if
 * already known, marked seen again; anything else stays in the pile,
 * marked "other". A post the call did not come back with is left unsorted
 * and tried again next time. A failure sorts nothing and costs nothing
 * but the attempt: the posts are still there to pick by hand.
 */

const BATCH = 30;

interface Row {
  id: string;
  url: string;
  author: string | null;
  group_name: string | null;
  text: string | null;
}

export async function sortReadPosts(organizationId: string, options: { limit?: number } = {}): Promise<{ sorted: number; businesses: number }> {
  if (!isAnthropicConfigured) return { sorted: 0, businesses: 0 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_seen_posts")
    .select("id, url, author, group_name, text")
    .eq("organization_id", organizationId)
    .eq("decision", "read")
    .is("kind", null)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? BATCH);
  const rows = ((data ?? []) as Row[]).filter((row) => (row.text ?? "").trim().length > 0);
  if (rows.length === 0) return { sorted: 0, businesses: 0 };

  const asked: PostToSort[] = rows.map((row) => ({ id: row.id, author: row.author, group: row.group_name, text: row.text ?? "" }));
  const answer = await askModel(asked);
  if (!answer) return { sorted: 0, businesses: 0 };

  const matched = matchSorted(asked, answer);
  let sorted = 0;
  let businesses = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const verdict = matched.get(row.id);
    if (!verdict) continue;
    let businessId: string | null = null;
    if (verdict.kind === "promotion") {
      businessId = await keepBusiness(organizationId, tidyBusiness(verdict.business ?? emptyBusiness(), row.author), row);
      if (businessId) businesses += 1;
    }
    await supabase
      .from("outreach_seen_posts")
      .update({
        kind: verdict.kind,
        kind_by: "model",
        business_id: businessId,
        decision: verdict.kind === "promotion" ? "advert" : "read",
        updated_at: now,
      })
      .eq("organization_id", organizationId)
      .eq("id", row.id)
      .eq("decision", "read");
    sorted += 1;
  }
  log.info("agent.posts_sorted", { organizationId, asked: rows.length, sorted, businesses });
  return { sorted, businesses };
}

/**
 * The owner says what a post is. Kept as theirs, and a promotion's
 * business is written down from the post the same way the model's is.
 */
export async function setPostKind(organizationId: string, seenId: string, kind: PostKind): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("outreach_seen_posts")
    .select("id, url, author, group_name, text, decision")
    .eq("organization_id", organizationId)
    .eq("id", seenId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Couldn't find that post." };
  if (row.decision !== "read" && row.decision !== "advert") return { ok: false, error: "That post has already been answered or passed." };

  let businessId: string | null = null;
  if (kind === "promotion") {
    const asked: PostToSort[] = [{ id: row.id, author: row.author, group: row.group_name, text: row.text ?? "" }];
    const answer = await askModel(asked, "The owner has already said this post is a promotion. Treat it as one and fill in the business.");
    const found = answer ? matchSorted(asked, answer).get(row.id) : undefined;
    businessId = await keepBusiness(organizationId, tidyBusiness(found?.business ?? emptyBusiness(), row.author), row);
  }
  const { error } = await supabase
    .from("outreach_seen_posts")
    .update({
      kind,
      kind_by: "owner",
      business_id: businessId,
      decision: kind === "promotion" ? "advert" : "read",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", seenId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

function emptyBusiness(): BusinessDetails {
  return { name: null, person: null, phone: null, email: null, website: null, services: [], area: null };
}

async function askModel(posts: PostToSort[], note?: string) {
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      // Sorting a handful of short posts is simple; low effort keeps it quick.
      output_config: { effort: "low", format: betaZodOutputFormat(SortResultSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SORT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: note ? `${note}\n\n${sortBrief(posts)}` : sortBrief(posts) }],
    });
    if (response.stop_reason === "refusal") {
      log.warn("agent.sort_refused", { posts: posts.length });
      return null;
    }
    return response.parsed_output?.posts ?? null;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log.warn("agent.sort_rate_limited", { posts: posts.length });
    else if (err instanceof Anthropic.APIError) log.warn("agent.sort_api_error", { status: err.status, message: err.message });
    else log.warn("agent.sort_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Write the business down, or mark it seen again.
 *
 * Details already known are kept; details newly written in this post fill
 * the gaps; services are merged. A business with nothing to key it on is
 * not kept, because a row nobody can contact is not a subcontractor.
 */
async function keepBusiness(organizationId: string, details: BusinessDetails, post: Row): Promise<string | null> {
  const key = businessKey(details);
  if (!key) return null;
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("outreach_businesses")
    .select("id, name, person, phone, email, website, services, area, times_seen")
    .eq("organization_id", organizationId)
    .eq("business_key", key)
    .maybeSingle();
  const seen = {
    last_seen_at: now,
    last_post_url: post.url || null,
    last_post_text: (post.text ?? "").slice(0, 1000),
    last_group_name: post.group_name,
    updated_at: now,
  };
  if (existing) {
    await supabase
      .from("outreach_businesses")
      .update({
        ...seen,
        name: existing.name ?? details.name,
        person: existing.person ?? details.person,
        phone: existing.phone ?? details.phone,
        email: existing.email ?? details.email,
        website: existing.website ?? details.website,
        area: existing.area ?? details.area,
        services: Array.from(new Set([...(existing.services ?? []), ...details.services])).slice(0, 20),
        times_seen: (existing.times_seen ?? 1) + 1,
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await supabase
    .from("outreach_businesses")
    .insert({ organization_id: organizationId, business_key: key, ...details, ...seen })
    .select("id")
    .single();
  if (error) {
    log.warn("agent.business_save_failed", { error: error.message });
    return null;
  }
  return data.id;
}

export interface BusinessRow {
  id: string;
  name: string | null;
  person: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  services: string[];
  area: string | null;
  timesSeen: number;
  lastSeenAt: string;
  lastPostUrl: string | null;
  lastPostText: string | null;
  lastGroupName: string | null;
}

/** The businesses seen advertising, most recently seen first. */
export async function listBusinesses(organizationId: string, limit = 150): Promise<BusinessRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_businesses")
    .select("id, name, person, phone, email, website, services, area, times_seen, last_seen_at, last_post_url, last_post_text, last_group_name")
    .eq("organization_id", organizationId)
    .is("removed_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    person: row.person,
    phone: row.phone,
    email: row.email,
    website: row.website,
    services: row.services ?? [],
    area: row.area,
    timesSeen: row.times_seen,
    lastSeenAt: row.last_seen_at,
    lastPostUrl: row.last_post_url,
    lastPostText: row.last_post_text,
    lastGroupName: row.last_group_name,
  }));
}

export async function removeBusiness(organizationId: string, id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_businesses")
    .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw error;
}
