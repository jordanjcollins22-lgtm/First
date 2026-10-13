"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { runAdsImport, spendRowsForDb } from "@/lib/data/google-ads-run";
import { postHeldReply, runGoogleBusiness } from "@/lib/data/google-business-run";
import { loadAutopilot, saveAutopilot } from "@/lib/data/marketing-autopilot";
import { stampClosed } from "@/lib/data/marketing-plays-run";
import { seedRankKeywords } from "@/lib/data/rank-run";
import { draftReviewReply } from "@/lib/data/review-reply-writer";
import { previewSeason, startSeason, type SeasonPreview } from "@/lib/data/seasonal-run";
import { getRealProfile } from "@/lib/data/team";
import { normalizeAutopilot, type AutopilotSettings } from "@/lib/marketing/autopilot-settings";
import { isStale, type ClosableKind } from "@/lib/marketing/play-closure";
import { SEASONS, type Season } from "@/lib/marketing/seasonal";
import { isSpendChannel, parseSpendCsv, type SpendChannel } from "@/lib/marketing/spend";
import { isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything a person presses on the marketing autopilot panels.
 *
 * Owner-level for anything that changes a setting, spends money, posts or
 * emails, checked against the account actually signed in (not a view-as).
 * The one exception is a round's own walker: the person a play is assigned
 * to may tap it done and send their walk's trail, because that is their job.
 */

export type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

const PAGES = ["/v2/marketing", "/my-day", "/attractors"];

function revalidate() {
  for (const p of PAGES) revalidatePath(p);
}

async function owner() {
  const me = await getRealProfile();
  if (!me) throw new Error("Not signed in.");
  if (!isOwnerLevel(me.roles)) throw new Error("Only an owner can do that.");
  return me;
}

async function guard<T>(name: string, work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[marketing-autopilot] ${name} failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const db = async () => (await createClient()) as unknown as SupabaseClient;
/** For the tables a signed-in user may only read: used after the owner check. */
const service = () => createAdminClient() as unknown as SupabaseClient;

// ---------------------------------------------------------------------------
// Settings

export async function saveAutopilotSettings(patch: Partial<AutopilotSettings>): Promise<Result<AutopilotSettings>> {
  return guard("saveAutopilotSettings", async () => {
    const me = await owner();
    const sb = await db();
    const current = await loadAutopilot(sb, me.organization_id);
    const next = normalizeAutopilot({
      ...current.settings,
      ...patch,
      enabled: { ...current.settings.enabled, ...(patch.enabled ?? {}) },
      unitCostCents: { ...current.settings.unitCostCents, ...(patch.unitCostCents ?? {}) },
    });
    await saveAutopilot(me.organization_id, next, me.id);
    // New towns or services mean new phrases to track; adding them is harmless.
    if (patch.rankTowns || patch.rankServices) await seedRankKeywords(sb, me.organization_id, next).catch(() => 0);
    revalidate();
    return next;
  });
}

// ---------------------------------------------------------------------------
// Plays

/** Give a round to a walker or an affiliate (anyone on the team). Null takes it back. */
export async function assignPlayTo(playId: string, profileId: string | null): Promise<Result> {
  return guard("assignPlayTo", async () => {
    const me = await owner();
    const sb = await db();
    if (profileId) {
      const { data } = await sb.from("profiles").select("id").eq("id", profileId).eq("organization_id", me.organization_id).maybeSingle();
      if (!data) throw new Error("That person is not on this team.");
    }
    const { error } = await sb
      .from("marketing_plays")
      .update({ assigned_to: profileId, assigned_at: profileId ? new Date().toISOString() : null, assigned_by: profileId ? me.id : null })
      .eq("id", playId)
      .eq("organization_id", me.organization_id);
    if (error) throw error;
    revalidate();
    return null;
  });
}

async function readPlay(sb: SupabaseClient, playId: string, org: string) {
  const { data } = await sb
    .from("marketing_plays")
    .select("id, kind, quantity, status, approval, assigned_to, created_at, approved_at, assigned_at")
    .eq("id", playId)
    .eq("organization_id", org)
    .maybeSingle();
  return data as { id: string; kind: ClosableKind; quantity: number; status: string; approval: string; assigned_to: string | null; created_at: string; approved_at: string | null; assigned_at: string | null } | null;
}

/**
 * The one-tap "done". Whoever the round was given to may press it, and so may
 * an owner. Approving it first is implied: the person standing on the street
 * with the hangers is the approval.
 */
export async function markPlayDone(playId: string): Promise<Result> {
  return guard("markPlayDone", async () => {
    const me = await getRealProfile();
    if (!me) throw new Error("Not signed in.");
    const sb = await db();
    const play = await readPlay(sb, playId, me.organization_id);
    if (!play) throw new Error("No such play.");
    const mine = play.assigned_to === me.id;
    if (!mine && !isOwnerLevel(me.roles)) throw new Error("This round isn't yours.");
    if (play.status !== "open") return null;
    if (play.approval === "pending") {
      await sb.rpc("marketing_play_review", { org: me.organization_id, the_play: playId, decision: "approve", by: me.id });
    }
    const { data, error } = await sb.rpc("marketing_play_set", { the_play: playId, new_status: "done", by: me.id, designs: 1 });
    if (error || !(data as { ok?: boolean } | null)?.ok) throw new Error(error?.message ?? "The play could not be closed.");
    const { settings } = await loadAutopilot(sb, me.organization_id);
    await stampClosed(
      sb,
      play,
      mine ? { reason: "assignee", note: "Tapped done by the person it was given to." } : { reason: "owner", note: "Closed by the owner." },
      settings
    );
    revalidate();
    return null;
  });
}

/** Skip a play for good (owner). */
export async function skipPlay(playId: string, note: string | null = null): Promise<Result> {
  return guard("skipPlay", async () => {
    const me = await owner();
    const sb = await db();
    const { data, error } = await sb.rpc("marketing_play_set", { the_play: playId, new_status: "skipped", by: me.id, designs: 1 });
    if (error || !(data as { ok?: boolean } | null)?.ok) throw new Error(error?.message ?? "The play could not be skipped.");
    await sb.from("marketing_plays").update({ closed_reason: "owner", closed_note: note || "Skipped by the owner.", cost_cents: 0 }).eq("id", playId).eq("organization_id", me.organization_id);
    revalidate();
    return null;
  });
}

/**
 * Points from a walker's phone while they walk a round. Only the person the
 * round is assigned to; at most 500 points a call; ignores fixes too vague
 * to say which side of the street.
 */
export async function recordPlayTrail(playId: string, points: { lat: number; lng: number; accuracy?: number | null; at: string }[]): Promise<Result<number>> {
  return guard("recordPlayTrail", async () => {
    const me = await getRealProfile();
    if (!me) throw new Error("Not signed in.");
    const sb = await db();
    const play = await readPlay(sb, playId, me.organization_id);
    if (!play || play.assigned_to !== me.id) throw new Error("This round isn't yours.");
    const rows = points
      .slice(0, 500)
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && (p.accuracy == null || p.accuracy <= 60))
      .map((p) => ({
        organization_id: me.organization_id,
        play_id: playId,
        profile_id: me.id,
        lat: p.lat,
        lng: p.lng,
        accuracy_m: p.accuracy ?? null,
        source: "walk",
        at: Number.isFinite(Date.parse(p.at)) ? new Date(p.at).toISOString() : new Date().toISOString(),
      }));
    if (rows.length === 0) return 0;
    const { error } = await sb.from("marketing_play_trail").insert(rows);
    if (error) throw error;
    return rows.length;
  });
}

/**
 * The one-off for the plays from before auto-expiry was switched on: every
 * open play with nothing happening on it for the expiry period is skipped
 * with a note. Started by the owner on purpose, so it may touch the backlog.
 */
export async function expireStalePlays(): Promise<Result<number>> {
  return guard("expireStalePlays", async () => {
    const me = await owner();
    const sb = await db();
    const { settings } = await loadAutopilot(sb, me.organization_id);
    const { data } = await sb
      .from("marketing_plays")
      .select("id, kind, quantity, status, approval, created_at, approved_at, assigned_at")
      .eq("organization_id", me.organization_id)
      .eq("status", "open")
      .limit(1000);
    const now = new Date();
    let expired = 0;
    for (const p of (data ?? []) as { id: string; kind: ClosableKind; quantity: number; status: "open"; approval: string; created_at: string; approved_at: string | null; assigned_at: string | null }[]) {
      const stale = isStale(
        { id: p.id, kind: p.kind, status: p.status, approval: p.approval, createdAt: p.created_at, approvedAt: p.approved_at, assignedAt: p.assigned_at, quantity: p.quantity },
        now,
        settings.playExpiryDays
      );
      if (!stale) continue;
      const { data: set } = await sb.rpc("marketing_play_set", { the_play: p.id, new_status: "skipped", by: me.id, designs: 1 });
      if (!(set as { ok?: boolean } | null)?.ok) continue;
      await sb
        .from("marketing_plays")
        .update({ closed_reason: "expired", closed_note: `Expired by the owner's clear-out: nothing happened on it for ${settings.playExpiryDays}+ days.`, cost_cents: 0 })
        .eq("id", p.id);
      expired++;
    }
    revalidate();
    return expired;
  });
}

// ---------------------------------------------------------------------------
// Reviews

export async function approveReviewReply(reviewId: string, reply: string): Promise<Result> {
  return guard("approveReviewReply", async () => {
    const me = await owner();
    const text = reply.trim();
    if (text.length < 5) throw new Error("Write a reply first.");
    const r = await postHeldReply(service(), me.organization_id, reviewId, text.slice(0, 4000), me.id);
    if (!r.ok) throw new Error(r.error);
    revalidate();
    return null;
  });
}

export async function skipReviewReply(reviewId: string): Promise<Result> {
  return guard("skipReviewReply", async () => {
    const me = await owner();
    const now = new Date().toISOString();
    const { error } = await service()
      .from("google_reviews")
      .update({ reply_status: "skipped", decided_by: me.id, decided_at: now, updated_at: now })
      .eq("id", reviewId)
      .eq("organization_id", me.organization_id);
    if (error) throw error;
    revalidate();
    return null;
  });
}

/** A draft for a review from before replies were switched on: drafted and held, never posted. */
export async function draftReplyNow(reviewId: string): Promise<Result<string>> {
  return guard("draftReplyNow", async () => {
    const me = await owner();
    const sb = service();
    const { data } = await sb.from("google_reviews").select("author, stars, body").eq("id", reviewId).eq("organization_id", me.organization_id).maybeSingle();
    if (!data) throw new Error("No such review.");
    const { data: org } = await sb.from("organizations").select("name").eq("id", me.organization_id).maybeSingle();
    const draft = await draftReviewReply(data as { author: string | null; stars: number | null; body: string | null }, (org as { name?: string } | null)?.name ?? "JS Landscaping");
    await sb.from("google_reviews").update({ reply_status: "held", reply_draft: draft.reply, updated_at: new Date().toISOString() }).eq("id", reviewId);
    revalidate();
    return draft.reply;
  });
}

/** Pull reviews, insights and spend now rather than at the next daily run. */
export async function runGoogleNow(): Promise<Result<string>> {
  return guard("runGoogleNow", async () => {
    const me = await owner();
    const admin = createAdminClient();
    const autopilot = await loadAutopilot(admin, me.organization_id);
    const gbp = await runGoogleBusiness(admin, me.organization_id, autopilot);
    const ads = await runAdsImport(admin, me.organization_id, autopilot.settings);
    revalidate();
    const parts = [
      gbp.connected ? `Business Profile: ${gbp.pulled} reviews read, ${gbp.added} new, ${gbp.posted} replied, ${gbp.held} held.` : `Business Profile: ${gbp.error ?? "not connected"}.`,
      ...ads.map((a) => (a.connected && !a.error ? `${a.provider === "google_lsa" ? "LSA" : "Google Ads"}: ${a.spendRows} spend rows, ${a.leads} leads.` : `${a.provider === "google_lsa" ? "LSA" : "Google Ads"}: ${a.error}`)),
    ];
    return parts.join(" ");
  });
}

// ---------------------------------------------------------------------------
// Spend

/** Spend from a CSV, for when there is no API access. A row read twice replaces itself. */
export async function uploadSpendCsv(csv: string, channel: string): Promise<Result<{ rows: number; problems: string[] }>> {
  return guard("uploadSpendCsv", async () => {
    const me = await owner();
    if (!isSpendChannel(channel)) throw new Error("Pick which channel this spend is for.");
    if (csv.length > 2_000_000) throw new Error("That file is too big; export a shorter date range.");
    const parsed = parseSpendCsv(csv, channel as SpendChannel);
    if (parsed.rows.length === 0) throw new Error(parsed.problems[0] ?? "Nothing in that file could be read.");
    const { error } = await service().from("marketing_spend").upsert(spendRowsForDb(me.organization_id, parsed.rows, "csv", me.id), { onConflict: "organization_id,external_key" });
    if (error) throw error;
    revalidate();
    return { rows: parsed.rows.length, problems: parsed.problems };
  });
}

/** One amount typed in: a month of Facebook ads, a print run, a sponsorship. */
export async function addManualSpend(input: { channel: string; day: string; amount: number; note?: string }): Promise<Result> {
  return guard("addManualSpend", async () => {
    const me = await owner();
    if (!isSpendChannel(input.channel)) throw new Error("Pick a channel.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error("Pick a date.");
    const cents = Math.round(Number(input.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) throw new Error("Enter an amount.");
    const { error } = await service().from("marketing_spend").insert({
      organization_id: me.organization_id,
      channel: input.channel,
      day: input.day,
      amount_cents: cents,
      campaign: input.note?.trim().slice(0, 120) || null,
      source: "manual",
      external_key: `manual:${input.channel}:${input.day}:${Date.now()}`,
      created_by: me.id,
    });
    if (error) throw error;
    revalidate();
    return null;
  });
}

// ---------------------------------------------------------------------------
// Seasonal email

function isSeason(v: string): v is Season {
  return (SEASONS as readonly string[]).includes(v);
}

export async function previewSeasonal(season: string): Promise<Result<SeasonPreview>> {
  return guard("previewSeasonal", async () => {
    const me = await owner();
    if (!isSeason(season)) throw new Error("Not a season.");
    return previewSeason(createAdminClient(), me.organization_id, season);
  });
}

/**
 * The owner starts a season after seeing the preview. The cron sends it in
 * daily batches through the one client-message door, so consent, quiet
 * hours and the approval policy all still apply.
 */
export async function startSeasonal(season: string): Promise<Result> {
  return guard("startSeasonal", async () => {
    const me = await owner();
    if (!isSeason(season)) throw new Error("Not a season.");
    const started = await startSeason(service(), me.organization_id, season, "owner", me.id);
    if (!started) throw new Error("That season has already been started this year.");
    revalidate();
    return null;
  });
}

export async function seedRankNow(): Promise<Result<number>> {
  return guard("seedRankNow", async () => {
    const me = await owner();
    const sb = await db();
    const { settings } = await loadAutopilot(sb, me.organization_id);
    const n = await seedRankKeywords(sb, me.organization_id, settings);
    revalidate();
    return n;
  });
}
