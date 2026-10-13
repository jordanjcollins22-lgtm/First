import type { SupabaseClient } from "@supabase/supabase-js";

import { loadChannelAttribution, type ChannelAttribution } from "@/lib/data/channel-attribution";
import { canPublishToFacebook } from "@/lib/social/facebook";
import { loadAutopilot, type AutopilotState } from "@/lib/data/marketing-autopilot";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { listIntegrations, type IntegrationSummary } from "@/lib/integrations/store";
import { placesKeyFor } from "@/lib/google/places-rank";
import type { MarketingPlay } from "@/lib/marketing-plays";
import { resultsByKind, unassignedTooLong, type ClosableKind, type KindResult } from "@/lib/marketing/play-closure";
import { reviewStats, type ReviewStats } from "@/lib/marketing/review-replies";
import { openSeasons, SEASONS, seasonYear, type Season } from "@/lib/marketing/seasonal";
import { createClient } from "@/lib/supabase/server";

/**
 * What the three marketing panels read. Each loader reads its own data with
 * the signed-in client, so RLS still decides; the integration rows are read
 * through the store (service role) and only their status leaves here, never
 * a key.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export const GOOGLE_PROVIDERS = ["google_business", "google_ads", "google_lsa", "google_places"] as const;

export interface IntegrationStatus {
  provider: string;
  status: "not_connected" | "connected" | "error";
  lastError: string | null;
  checkedAt: string | null;
}

async function googleStatus(org: string): Promise<IntegrationStatus[]> {
  const rows = await listIntegrations(org).catch(() => [] as IntegrationSummary[]);
  const places = await placesKeyFor(org).catch(() => null);
  return GOOGLE_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    if (provider === "google_places" && !row && places) return { provider, status: "connected" as const, lastError: null, checkedAt: null };
    return {
      provider,
      status: row?.status ?? "not_connected",
      lastError: row?.last_error ?? null,
      checkedAt: row?.last_checked_at ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Digital

export interface DigitalPanelData {
  autopilot: AutopilotState;
  attribution: ChannelAttribution;
  google: IntegrationStatus[];
  insights: { calls: number; directions: number; websiteClicks: number; days: number };
  reviews: ReviewStats & { held: number };
  social: { scheduled: number; overdue: number; autoMade: number; facebookReady: boolean };
  rank: { keywords: number; scannedThisWeek: number };
  seasons: { season: Season; open: boolean; run: { status: string; sent: number; audience: number } | null }[];
  /** The two outbound machines the report found idle (hotspot #10). */
  outbound: { pmSending: boolean; pmCompanies: number; campaignsRunning: number; campaignsDraft: number };
}

export async function loadDigitalPanel(now = new Date()): Promise<DigitalPanelData> {
  const supabase = await createClient();
  const sb = untyped(supabase);
  const org = await getCurrentOrganizationId();
  const autopilot = await loadAutopilot(supabase, org);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [attribution, google, insightRows, reviewRows, socialRows, keywordCount, scanCount, runs, facebookReady, pm, pmCount, campaigns] = await Promise.all([
    loadChannelAttribution({ low: autopilot.settings.spendTargetLow, high: autopilot.settings.spendTargetHigh }, now),
    googleStatus(org),
    sb.from("google_business_insights").select("calls, directions, website_clicks").eq("organization_id", org).gte("day", since30.toISOString().slice(0, 10)),
    sb.from("google_reviews").select("stars, reviewed_at, reply_status").eq("organization_id", org).limit(2000),
    sb.from("social_posts").select("status, scheduled_for, auto_source").eq("organization_id", org).eq("placement", "page").eq("status", "scheduled").limit(500),
    sb.from("rank_keywords").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("active", true),
    sb.from("rank_scans").select("id", { count: "exact", head: true }).eq("organization_id", org).gte("ran_at", weekAgo),
    sb.from("seasonal_campaign_runs").select("season, year, status, sent, audience").eq("organization_id", org).eq("year", seasonYear(now)),
    canPublishToFacebook(org).catch(() => false),
    sb.from("pm_outreach_settings").select("sending_on").eq("organization_id", org).maybeSingle(),
    sb.from("pm_companies").select("id", { count: "exact", head: true }).eq("organization_id", org),
    sb.from("email_campaigns").select("status").eq("organization_id", org),
  ]);
  const campaignRows = (campaigns.data ?? []) as { status: string }[];

  const ins = (insightRows.data ?? []) as { calls: number; directions: number; website_clicks: number }[];
  const reviews = (reviewRows.data ?? []) as { stars: number | null; reviewed_at: string | null; reply_status: string }[];
  const posts = (socialRows.data ?? []) as { status: string; scheduled_for: string | null; auto_source: string | null }[];
  const runRows = (runs.data ?? []) as { season: Season; status: string; sent: number; audience: number }[];
  const open = new Set(openSeasons(now));

  return {
    autopilot,
    attribution,
    google,
    insights: {
      calls: ins.reduce((n, r) => n + (r.calls ?? 0), 0),
      directions: ins.reduce((n, r) => n + (r.directions ?? 0), 0),
      websiteClicks: ins.reduce((n, r) => n + (r.website_clicks ?? 0), 0),
      days: ins.length,
    },
    reviews: {
      ...reviewStats(
        reviews.map((r) => ({ stars: r.stars, reviewedAt: r.reviewed_at, replied: ["posted", "existing"].includes(r.reply_status) })),
        now
      ),
      held: reviews.filter((r) => r.reply_status === "held").length,
    },
    social: {
      scheduled: posts.length,
      overdue: posts.filter((p) => p.scheduled_for && Date.parse(p.scheduled_for) < now.getTime() - 3_600_000).length,
      autoMade: posts.filter((p) => p.auto_source === "crew_photos").length,
      facebookReady,
    },
    rank: { keywords: keywordCount.count ?? 0, scannedThisWeek: scanCount.count ?? 0 },
    outbound: {
      pmSending: Boolean((pm.data as { sending_on?: boolean } | null)?.sending_on),
      pmCompanies: pmCount.count ?? 0,
      campaignsRunning: campaignRows.filter((c) => c.status === "running").length,
      campaignsDraft: campaignRows.filter((c) => c.status === "draft").length,
    },
    seasons: SEASONS.map((season) => {
      const run = runRows.find((r) => r.season === season);
      return { season, open: open.has(season), run: run ? { status: run.status, sent: run.sent, audience: run.audience } : null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Reviews

export interface ReviewRow {
  id: string;
  author: string | null;
  stars: number | null;
  body: string | null;
  reviewedAt: string | null;
  replyStatus: string;
  replyDraft: string | null;
  replyBody: string | null;
  replyError: string | null;
}

export interface ReviewsPanelData {
  connected: boolean;
  lastError: string | null;
  autopilot: AutopilotState;
  stats: ReviewStats;
  held: ReviewRow[];
  recent: ReviewRow[];
}

export async function loadReviewsPanel(now = new Date()): Promise<ReviewsPanelData> {
  const supabase = await createClient();
  const sb = untyped(supabase);
  const org = await getCurrentOrganizationId();
  const [autopilot, google, { data }] = await Promise.all([
    loadAutopilot(supabase, org),
    googleStatus(org),
    sb
      .from("google_reviews")
      .select("id, author, stars, body, reviewed_at, reply_status, reply_draft, reply_body, reply_error")
      .eq("organization_id", org)
      .order("reviewed_at", { ascending: false })
      .limit(500),
  ]);
  const gbp = google.find((g) => g.provider === "google_business");
  const rows: ReviewRow[] = ((data ?? []) as {
    id: string;
    author: string | null;
    stars: number | null;
    body: string | null;
    reviewed_at: string | null;
    reply_status: string;
    reply_draft: string | null;
    reply_body: string | null;
    reply_error: string | null;
  }[]).map((r) => ({
    id: r.id,
    author: r.author,
    stars: r.stars,
    body: r.body,
    reviewedAt: r.reviewed_at,
    replyStatus: r.reply_status,
    replyDraft: r.reply_draft,
    replyBody: r.reply_body,
    replyError: r.reply_error,
  }));
  return {
    connected: gbp?.status === "connected",
    lastError: gbp?.lastError ?? null,
    autopilot,
    stats: reviewStats(rows.map((r) => ({ stars: r.stars, reviewedAt: r.reviewedAt, replied: ["posted", "existing"].includes(r.replyStatus) })), now),
    held: rows.filter((r) => r.replyStatus === "held" || r.replyStatus === "failed"),
    recent: rows.slice(0, 25),
  };
}

// ---------------------------------------------------------------------------
// Physical

export interface PlayRow extends MarketingPlay {
  costCents: number | null;
  closedReason: string | null;
  closedNote: string | null;
  leads: number;
  sold: number;
}

export interface PhysicalPanelData {
  autopilot: AutopilotState;
  plays: PlayRow[];
  people: { id: string; name: string; affiliate: boolean }[];
  unassigned: PlayRow[];
  byKind: KindResult[];
  /** Share of plays closed in the last 90 days that closed within 7 days of being made. */
  closedWithinWeek: number | null;
  totals: { open: number; pending: number; done90: number; expired90: number };
}

export async function loadPhysicalPanel(now = new Date()): Promise<PhysicalPanelData> {
  const supabase = await createClient();
  const sb = untyped(supabase);
  const org = await getCurrentOrganizationId();
  const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [autopilot, { data: listed }, { data: extra }, { data: results }, { data: people }] = await Promise.all([
    loadAutopilot(supabase, org),
    sb.rpc("marketing_plays_list", { org, include_done: true }),
    sb.from("marketing_plays").select("id, cost_cents, closed_reason, closed_note, updated_at").eq("organization_id", org).limit(5000),
    sb.rpc("marketing_play_results", { org, since: new Date(now.getTime() - 365 * 86_400_000).toISOString() }),
    sb.from("profiles").select("id, full_name, email, is_affiliate").eq("organization_id", org).order("full_name"),
  ]);
  const extraBy = new Map(((extra ?? []) as { id: string; cost_cents: number | null; closed_reason: string | null; closed_note: string | null; updated_at: string }[]).map((e) => [e.id, e]));
  const resultBy = new Map(((results ?? []) as { play_id: string; leads: number; sold: number }[]).map((r) => [r.play_id, r]));
  const plays: PlayRow[] = ((Array.isArray(listed) ? listed : []) as MarketingPlay[]).map((p) => ({
    ...p,
    costCents: extraBy.get(p.id)?.cost_cents ?? null,
    closedReason: extraBy.get(p.id)?.closed_reason ?? null,
    closedNote: extraBy.get(p.id)?.closed_note ?? null,
    leads: resultBy.get(p.id)?.leads ?? 0,
    sold: resultBy.get(p.id)?.sold ?? 0,
  }));

  const finished = plays.filter((p) => p.status === "done" && p.costCents != null);
  // The cohort made between 97 and 7 days ago: each has had its full week.
  const weekMs = 7 * 86_400_000;
  const cohort = plays.filter((p) => {
    const age = now.getTime() - Date.parse(p.createdAt);
    return age >= weekMs && age <= 97 * 86_400_000;
  });
  const quick = cohort.filter((p) => p.status === "done" && p.doneAt && Date.parse(p.doneAt) - Date.parse(p.createdAt) <= weekMs);
  return {
    autopilot,
    plays,
    people: ((people ?? []) as { id: string; full_name: string | null; email: string | null; is_affiliate: boolean | null }[]).map((p) => ({
      id: p.id,
      name: p.full_name || p.email || "Someone",
      affiliate: Boolean(p.is_affiliate),
    })),
    unassigned: unassignedTooLong(plays, now) as PlayRow[],
    byKind: resultsByKind(finished.map((p) => ({ kind: p.kind as ClosableKind, costCents: p.costCents ?? 0, leads: p.leads, sold: p.sold }))),
    closedWithinWeek: cohort.length > 0 ? quick.length / cohort.length : null,
    totals: {
      open: plays.filter((p) => p.status === "open").length,
      pending: plays.filter((p) => p.status === "open" && p.approval === "pending").length,
      done90: plays.filter((p) => p.status === "done" && p.doneAt && p.doneAt >= since90).length,
      expired90: plays.filter((p) => {
        const e = extraBy.get(p.id);
        return p.status === "skipped" && e?.closed_reason === "expired" && e.updated_at >= since90;
      }).length,
    },
  };
}

