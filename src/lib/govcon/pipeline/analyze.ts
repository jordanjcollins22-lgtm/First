import { analyzeSolicitation, isAiConfigured, type SolicitationAnalysis } from "../ai";
import { loadSolicitationDocuments } from "../documents";
import { scoreOpportunity } from "../scoring";
import { getNoticeDetail } from "../sources/sam-attachments";
import { anchorFromComparables, findComparableAwards } from "../sources/usaspending";
import { sanitizeScopeForSub } from "../templates";
import { logEvent, rowToOpp, timeLeft, type PipelineContext } from "./context";

/**
 * Stage 2 — read the solicitation. For the top-scoring new opportunities:
 * pull the full notice text and attachments, have Claude extract the scope,
 * evaluation criteria, submission instructions and subcontracting clause,
 * write a clean sub-facing scope of work, and look up comparable past
 * awards for a price anchor. Re-scores with what the documents revealed.
 */
export async function analyze(ctx: PipelineContext, limit = 6) {
  const stats = { analyzed: 0, toSourcing: 0, noBid: 0, errors: 0 };
  const minDeadline = new Date(ctx.now.getTime() + ctx.profile.minDaysToRespond * 86_400_000).toISOString();
  const { data: rows, error } = await ctx.db
    .from("govcon_opportunities")
    .select("*")
    .eq("status", "new")
    .eq("recommendation", "bid")
    .in("notice_type", ["solicitation", "combined_synopsis_solicitation"])
    .gt("response_deadline", minDeadline)
    .order("score", { ascending: false })
    .limit(limit);
  if (error) throw error;

  for (const row of rows ?? []) {
    if (timeLeft(ctx) < 90_000) break;
    stats.analyzed++;
    try {
      const opp = rowToOpp(row);
      const detail = await getNoticeDetail(opp.externalId).catch(() => null);
      if (detail?.description && detail.description.length > (opp.description?.length ?? 0)) opp.description = detail.description;
      if (detail?.placeOfPerformance) {
        opp.placeOfPerformance = {
          city: opp.placeOfPerformance.city ?? detail.placeOfPerformance.city,
          state: opp.placeOfPerformance.state ?? detail.placeOfPerformance.state,
          zip: opp.placeOfPerformance.zip ?? detail.placeOfPerformance.zip,
          country: opp.placeOfPerformance.country ?? detail.placeOfPerformance.country,
        };
      }

      const { documents, attachments, skipped } = await loadSolicitationDocuments(opp.externalId);

      let analysis: SolicitationAnalysis | null = null;
      if (isAiConfigured()) {
        analysis = await analyzeSolicitation({ title: opp.title, noticeText: opp.description ?? "", documents });
        const site = analysis.siteAddress;
        opp.placeOfPerformance = {
          city: site.city ?? opp.placeOfPerformance.city,
          state: site.state ?? opp.placeOfPerformance.state,
          zip: site.zip ?? opp.placeOfPerformance.zip,
          country: opp.placeOfPerformance.country,
        };
        if (analysis.estimatedValue && !opp.estimatedValue) opp.estimatedValue = analysis.estimatedValue;
      }

      const comparables = await findComparableAwards(opp, ctx.now).catch(() => []);
      const anchor = anchorFromComparables(comparables);

      // Re-score with document findings folded in.
      const rescored = scoreOpportunity(
        { ...opp, description: [opp.description, ...(analysis?.redFlags ?? [])].join("\n") },
        ctx.profile,
        { now: ctx.now, losClausePresent: analysis?.limitationsOnSubcontractingClause ?? null }
      );

      let status: "sourcing" | "no_bid" = "sourcing";
      let reason: string | null = null;
      if (rescored.recommendation === "no_bid") {
        status = "no_bid";
        reason = rescored.disqualifiers.join("; ") || "Score dropped after reading the documents";
      } else if (analysis && (!analysis.brokerable || analysis.recommendation === "no_bid")) {
        status = "no_bid";
        reason = analysis.brokerable ? analysis.recommendationReason : analysis.brokerableReason;
      }

      const subScope =
        analysis?.subScopeOfWork ??
        sanitizeScopeForSub(opp.description ?? opp.title, [opp.solicitationNumber, opp.externalId]);

      await ctx.db
        .from("govcon_opportunities")
        .update({
          status,
          status_reason: reason,
          analysis: analysis ? { ...analysis } : { subScopeOfWork: subScope, aiSkipped: true },
          attachments: attachments.map((a) => ({ name: a.name, url: a.downloadUrl, size: a.size })),
          comparables: comparables.slice(0, 10),
          price_anchor: anchor,
          pop_city: opp.placeOfPerformance.city ?? null,
          pop_state: opp.placeOfPerformance.state ?? null,
          pop_zip: opp.placeOfPerformance.zip ?? null,
          description: opp.description?.slice(0, 100_000) ?? null,
          estimated_value: opp.estimatedValue,
          score: rescored.total,
          recommendation: rescored.recommendation,
          score_detail: { factors: rescored.factors, disqualifiers: rescored.disqualifiers, flags: rescored.flags },
          subcontracting: rescored.subcontracting,
          analyzed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);

      if (status === "no_bid") stats.noBid++;
      else stats.toSourcing++;
      await logEvent(
        ctx,
        row.id,
        "analyzed",
        status === "no_bid"
          ? `No-bid after reading ${documents.length} document(s): ${reason}`
          : `Read ${documents.length} document(s)${skipped.length ? ` (skipped ${skipped.length})` : ""}; ${anchor ? `price anchor ≈ $${Math.round(anchor.annualAmount).toLocaleString()}/yr` : "no price anchor"}; moving to sub sourcing`,
        { documents: documents.map((d) => d.name), skipped }
      );
    } catch (e) {
      stats.errors++;
      // One retry on the next run, then give up so a bad notice can't block the queue.
      await ctx.db
        .from("govcon_opportunities")
        .update(row.last_error ? { last_error: (e as Error).message, status: "no_bid", status_reason: "Analysis failed twice" } : { last_error: (e as Error).message })
        .eq("id", row.id);
      await logEvent(ctx, row.id, "error", `Analysis failed: ${(e as Error).message}`);
    }
  }
  return stats;
}
