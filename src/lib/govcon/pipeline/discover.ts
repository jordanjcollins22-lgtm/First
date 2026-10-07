import type { GovconOpportunityRow } from "@/lib/supabase/database.types";

import { createContractFromWin } from "../contracts";
import { opportunityKey } from "../normalize";
import { scoreOpportunity } from "../scoring";
import { fetchAllBonfire } from "../sources/bonfire";
import { searchRecentOpportunities } from "../sources/sam-api";
import { streamSamCsv, type AwardNoticeRow } from "../sources/sam-csv";
import type { Opportunity } from "../types";
import { logEvent, oppToRow, saveSettingsState, type PipelineContext } from "./context";

/**
 * Stage 1 — find and score new solicitations. Uses the keyless SAM.gov
 * daily CSV (skipped when its ETag hasn't changed); with SAM_API_KEY set,
 * also pulls the last 2 days from the API for freshness between rebuilds.
 * Only notices that match a brokerable trade and aren't disqualified are
 * stored. Award notices are matched against bids we submitted (win/loss).
 */
const PRE_ANALYSIS_STATUSES = new Set(["new", "no_bid", "needs_docs"]);
const OPEN_STATUSES = ["new", "needs_docs", "sourcing", "awaiting_quotes", "ready"] as const;

export async function discover(ctx: PipelineContext) {
  const stats = { scanned: 0, candidates: 0, inserted: 0, updated: 0, amended: 0, awardsMatched: 0, expired: 0, csv: "skipped" as string, portalBids: 0, portalsFailed: [] as string[] };
  const byKey = new Map<string, Opportunity>();
  const awards: AwardNoticeRow[] = [];

  const consider = (opp: Opportunity) => {
    stats.scanned++;
    if (!opp.active || !opp.title) return;
    const score = scoreOpportunity(opp, ctx.profile, { now: ctx.now });
    if (!score.trade || score.recommendation === "no_bid") return;
    const key = opportunityKey(opp);
    const existing = byKey.get(key);
    if (!existing || (opp.postedDate ?? "") > (existing.postedDate ?? "")) byKey.set(key, opp);
  };

  const csv = await streamSamCsv({
    ifNoneMatch: (ctx.settingsState.csvEtag as string | undefined) ?? null,
    onOpportunity: consider,
    onAward: (a) => {
      if (a.solicitationNumber) awards.push(a);
    },
  });
  stats.csv = csv.notModified ? "unchanged" : `${csv.rows} rows`;

  if (ctx.keys.sam) {
    try {
      for (const opp of await searchRecentOpportunities(ctx.keys.sam, 2)) consider(opp);
    } catch (e) {
      await logEvent(ctx, null, "warning", `SAM API search failed: ${(e as Error).message}`);
    }
  }
  // State & local portals (titles + deadlines; documents come by upload).
  try {
    const bonfire = await fetchAllBonfire(ctx.profile.bonfirePortals);
    stats.portalBids = bonfire.opportunities.length;
    stats.portalsFailed = bonfire.failed;
    for (const opp of bonfire.opportunities) consider(opp);
  } catch (e) {
    await logEvent(ctx, null, "warning", `Portal scan failed: ${(e as Error).message}`);
  }
  stats.candidates = byKey.size;

  // Load existing rows for these keys in chunks.
  const keys = [...byKey.keys()];
  const existing = new Map<string, Pick<GovconOpportunityRow, "id" | "status" | "notice_id" | "response_deadline">>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await ctx.db
      .from("govcon_opportunities")
      .select("id, opportunity_key, status, notice_id, response_deadline")
      .in("opportunity_key", keys.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) existing.set(r.opportunity_key, r);
  }

  const inserts = [];
  for (const [key, opp] of byKey) {
    const score = scoreOpportunity(opp, ctx.profile, { now: ctx.now });
    const row = oppToRow(opp, key, score);
    const prev = existing.get(key);
    if (!prev) {
      inserts.push({ ...row, status: "new" as const });
      continue;
    }
    if (prev.notice_id === opp.externalId) continue; // nothing new
    // Amendment: refresh notice fields. Keep pipeline state for anything
    // already analyzed; re-score rows still waiting for analysis.
    const update = PRE_ANALYSIS_STATUSES.has(prev.status)
      ? row
      : { notice_id: row.notice_id, title: row.title, response_deadline: row.response_deadline, description: row.description, points_of_contact: row.points_of_contact };
    await ctx.db.from("govcon_opportunities").update(update).eq("id", prev.id);
    stats.updated++;
    if (prev.response_deadline !== opp.responseDeadline && !PRE_ANALYSIS_STATUSES.has(prev.status)) {
      stats.amended++;
      await logEvent(ctx, prev.id, "amendment", `Amendment posted — deadline now ${opp.responseDeadline ?? "unknown"}`, { noticeId: opp.externalId });
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    const { error } = await ctx.db.from("govcon_opportunities").insert(inserts.slice(i, i + 100));
    if (error) throw error;
  }
  stats.inserted = inserts.length;

  stats.awardsMatched = await matchAwards(ctx, awards);
  stats.expired = await expireStale(ctx);

  if (!csv.notModified && csv.etag) await saveSettingsState(ctx, { csvEtag: csv.etag, csvProcessedAt: ctx.now.toISOString() });
  await logEvent(ctx, null, "discover", `Scanned ${stats.scanned} notices → ${stats.inserted} new opportunities, ${stats.updated} updated`, stats);
  return stats;
}

/** Award notices for solicitations we submitted on → won/lost. */
async function matchAwards(ctx: PipelineContext, awards: AwardNoticeRow[]): Promise<number> {
  if (!awards.length) return 0;
  const { data: submitted } = await ctx.db
    .from("govcon_opportunities")
    .select("id, solicitation_number, agency")
    .eq("status", "submitted");
  if (!submitted?.length) return 0;
  const norm = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ours = norm(ctx.company.name).slice(0, 12);
  let matched = 0;
  for (const opp of submitted) {
    const award = awards.find((a) => norm(a.solicitationNumber) === norm(opp.solicitation_number));
    if (!award) continue;
    const won = ours.length >= 4 && norm(award.awardee).includes(ours);
    await ctx.db.from("govcon_opportunities").update({ status: won ? "won" : "lost", status_reason: `Awarded to ${award.awardee ?? "?"} for $${award.amount ?? "?"}` }).eq("id", opp.id);
    await ctx.db.from("govcon_bids").update({ status: won ? "won" : "lost", award_amount: award.amount, awardee: award.awardee }).eq("opportunity_id", opp.id);
    if (won) await createContractFromWin(ctx.db, opp.id, award.amount);
    await logEvent(ctx, opp.id, won ? "won" : "lost", won ? `WON — award ${award.awardNumber} for $${award.amount}` : `Lost to ${award.awardee} at $${award.amount}`, award);
    matched++;
  }
  return matched;
}

async function expireStale(ctx: PipelineContext): Promise<number> {
  const { data } = await ctx.db
    .from("govcon_opportunities")
    .update({ status: "expired", status_reason: "Response deadline passed" })
    .in("status", OPEN_STATUSES)
    .lt("response_deadline", ctx.now.toISOString())
    .select("id");
  return data?.length ?? 0;
}
