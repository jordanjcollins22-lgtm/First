import type { GovconQuoteRow } from "@/lib/supabase/database.types";

import { checkQuote, draftProposal, isAiConfigured, type QuoteCheck, type SolicitationAnalysis, type SolicitationDocument } from "../ai";
import { checkSubcontractPlan } from "../compliance";
import { isEmailConfigured, sendEmail } from "../email";
import { priceBid, type PriceAnchor } from "../pricing";
import { selectBestQuote, verifySmallStatus } from "../quote-selection";
import { TRADE_BY_KEY } from "../trades";
import type { TradeKey } from "../types";
import type { SubcontractingAssessment } from "../types";
import { logEvent, timeLeft, type PipelineContext } from "./context";

/**
 * Stage 5 — once enough quotes are in (3+) or the quote window closes:
 * check each quote against the scope, pick the lowest compliant one, price
 * the bid (quote + markup, sanity-checked against past awards), check the
 * subcontracting limits, and draft the proposal. The opportunity then waits
 * in "ready" for a human to review and submit.
 */
const ENOUGH_QUOTES = 3;

export async function evaluate(ctx: PipelineContext, limit = 5) {
  const stats = { checked: 0, ready: 0, noBid: 0, waiting: 0 };
  const { data: opps, error } = await ctx.db
    .from("govcon_opportunities")
    .select("*")
    .eq("status", "awaiting_quotes")
    .order("response_deadline", { ascending: true })
    .limit(25);
  if (error) throw error;

  let processed = 0;
  for (const opp of opps ?? []) {
    if (processed >= limit || timeLeft(ctx) < 90_000) break;
    const [{ data: quotes }, { data: rfqs }] = await Promise.all([
      ctx.db.from("govcon_quotes").select("*").eq("opportunity_id", opp.id),
      ctx.db.from("govcon_rfqs").select("quote_due_at, status").eq("opportunity_id", opp.id),
    ]);
    const windowClosed = (rfqs ?? []).every((r) => !r.quote_due_at || Date.parse(r.quote_due_at) <= ctx.now.getTime());
    const allAnswered = (rfqs ?? []).every((r) => !["queued", "sent", "viewed"].includes(r.status));
    if ((quotes?.length ?? 0) < ENOUGH_QUOTES && !windowClosed && !allAnswered) {
      stats.waiting++;
      continue;
    }
    processed++;
    const analysis = (opp.analysis ?? {}) as Partial<SolicitationAnalysis>;

    if (!quotes?.length) {
      await ctx.db.from("govcon_opportunities").update({ status: "no_bid", status_reason: "No sub quotes received" }).eq("id", opp.id);
      await logEvent(ctx, opp.id, "no_bid", "No-bid: no subcontractor quotes came in before the cutoff");
      stats.noBid++;
      continue;
    }

    // AI scope check for any quote not yet checked.
    if (isAiConfigured() && analysis.subScopeOfWork) {
      for (const q of quotes) {
        if (q.compliance) continue;
        q.compliance = await checkQuote({
          subScopeOfWork: analysis.subScopeOfWork,
          quotedAmount: q.amount,
          quoteNotes: q.notes,
          quoteDocument: await loadQuoteFile(ctx, q),
        }).catch(() => null);
        if (q.compliance) await ctx.db.from("govcon_quotes").update({ compliance: q.compliance }).eq("id", q.id);
        stats.checked++;
      }
    }

    // Verify small-business claims against SAM where we can.
    const naics = [...new Set([...(opp.naics_code ? [opp.naics_code] : []), ...(opp.trade ? TRADE_BY_KEY[opp.trade as TradeKey]?.naicsCodes ?? [] : [])])];
    const { data: quoteSubs } = await ctx.db.from("govcon_subcontractors").select("id, uei").in("id", quotes.map((q) => q.subcontractor_id));
    const ueis = [...new Set([...quotes.map((q) => q.uei), ...(quoteSubs ?? []).map((s) => s.uei)].filter((u): u is string => Boolean(u)))];
    const { data: registryRows } = ueis.length
      ? await ctx.db.from("govcon_sam_entities").select("uei, small_naics").in("uei", ueis)
      : { data: [] as Array<{ uei: string; small_naics: string[] }> };
    const registryByUei = new Map((registryRows ?? []).map((r) => [r.uei, r]));
    const verificationWarnings: string[] = [];
    const verifiedQuotes = quotes.map((q) => {
      const uei = q.uei ?? quoteSubs?.find((s) => s.id === q.subcontractor_id)?.uei ?? null;
      const v = verifySmallStatus({ selfCertified: q.is_small_business, registry: uei ? registryByUei.get(uei) ?? null : null, naics });
      if (v.warning) verificationWarnings.push(v.warning);
      return { ...q, is_small_business: v.isSmall, compliance: (q.compliance as QuoteCheck | null) ?? null };
    });

    const subcontracting = opp.subcontracting as SubcontractingAssessment;
    const selection = selectBestQuote(verifiedQuotes, subcontracting);
    if (!selection.chosen) {
      if (windowClosed) {
        const reasons = selection.rejected.map((r) => r.reason).join(" | ");
        await ctx.db.from("govcon_opportunities").update({ status: "no_bid", status_reason: `No usable quote: ${reasons}` }).eq("id", opp.id);
        await logEvent(ctx, opp.id, "no_bid", `No-bid: ${quotes.length} quote(s), none usable — ${reasons}`);
        stats.noBid++;
      } else stats.waiting++;
      continue;
    }

    const chosen = selection.chosen;
    const anchor = opp.price_anchor as PriceAnchor | null;
    // Anchors are annual and quotes cover every period, so the anchor only
    // applies once we know the period length (from the AI analysis).
    const months = analysis.periodOfPerformance?.baseMonths ?? null;
    const periods = 1 + (analysis.periodOfPerformance?.optionPeriods ?? 0);
    const scaledAnchor =
      anchor && months ? { ...anchor, annualAmount: anchor.annualAmount * (months / 12) * periods } : null;
    const pricing = priceBid({
      subQuote: chosen.amount,
      targetMarkup: ctx.profile.targetMarkup,
      minMarkup: ctx.profile.minMarkup,
      anchor: scaledAnchor,
    });

    const los = checkSubcontractPlan({
      assessment: subcontracting,
      awardAmount: pricing.price,
      subAmount: chosen.amount,
      subIsSimilarlySituated: Boolean(chosen.is_small_business && chosen.uses_own_employees),
    });

    const { data: sub } = await ctx.db.from("govcon_subcontractors").select("name").eq("id", chosen.subcontractor_id).single();

    let proposal = null;
    if (isAiConfigured() && analysis.scopeSummary) {
      proposal = await draftProposal({
        company: ctx.company,
        solicitation: { title: opp.title, number: opp.solicitation_number, agency: opp.agency },
        analysis: analysis as SolicitationAnalysis,
        subcontractor: { name: sub?.name ?? "Subcontractor", references: chosen.references_text, yearsInBusiness: null },
        price: { total: pricing.price, lines: [{ description: opp.title, amount: pricing.price }] },
      }).catch(async (e) => {
        await logEvent(ctx, opp.id, "error", `Proposal draft failed: ${(e as Error).message}`);
        return null;
      });
    }

    await ctx.db.from("govcon_bids").upsert(
      {
        opportunity_id: opp.id,
        quote_id: chosen.id,
        sub_cost: chosen.amount,
        price: pricing.price,
        markup: pricing.markup,
        pricing: { ...pricing, warnings: [...pricing.warnings, ...selection.warnings, ...(subcontracting.status === "similarly_situated_required" ? verificationWarnings : [])], rejected: selection.rejected.map((r) => ({ quoteId: r.quote.id, amount: r.quote.amount, reason: r.reason })) },
        proposal,
        compliance_check: los,
        status: "draft",
      },
      { onConflict: "opportunity_id" }
    );
    await ctx.db.from("govcon_opportunities").update({ status: "ready", status_reason: null }).eq("id", opp.id);
    await logEvent(
      ctx,
      opp.id,
      "ready",
      `Bid ready: ${sub?.name ?? "sub"} at $${chosen.amount.toLocaleString()} → our price $${pricing.price.toLocaleString()} (${Math.round(pricing.markup * 100)}% markup)${los.compliant ? "" : ` — ⚠ ${los.message}`}`
    );
    stats.ready++;

    if (isEmailConfigured() && ctx.company.email) {
      await sendEmail({
        to: ctx.company.email,
        subject: `Bid ready to review: ${opp.title}`,
        text: `A bid is priced and drafted.\n\n${opp.title}\nDue: ${opp.response_deadline}\nSub: ${sub?.name} at $${chosen.amount.toLocaleString()}\nOur price: $${pricing.price.toLocaleString()}\n\nReview and submit: ${ctx.appUrl}/govcon/opportunities/${opp.id}`,
      }).catch(() => undefined);
    }
  }
  return stats;
}

async function loadQuoteFile(ctx: PipelineContext, q: GovconQuoteRow): Promise<SolicitationDocument | null> {
  if (!q.file_path || !q.file_path.toLowerCase().endsWith(".pdf")) return null;
  const { data } = await ctx.db.storage.from("govcon-quotes").download(q.file_path);
  if (!data) return null;
  return { name: "Subcontractor quote", kind: "pdf", base64: Buffer.from(await data.arrayBuffer()).toString("base64") };
}
