import type { GovconOpportunityRow, GovconRfqRow, GovconSubcontractorRow } from "@/lib/supabase/database.types";

import type { SolicitationAnalysis } from "../ai";
import { isEmailConfigured, sendEmail } from "../email";
import { locationLabel } from "../subfinder";
import { rfqEmail } from "../templates";
import { TRADE_BY_KEY } from "../trades";
import type { SubcontractingAssessment, TradeKey } from "../types";
import { logEvent, rowToOpp, timeLeft, type PipelineContext } from "./context";

/**
 * Stage 4 — send queued RFQ emails, nudge non-responders (day 2 and day 4),
 * and close out RFQs whose quote due date has passed.
 */
const FOLLOWUP_AFTER_MS = 2 * 86_400_000;
const MAX_FOLLOWUPS = 2;

export function quoteUrl(ctx: PipelineContext, token: string) {
  return `${ctx.appUrl}/quote/${token}`;
}

export async function outreach(ctx: PipelineContext) {
  const stats = { sent: 0, followups: 0, closed: 0, failed: 0, skippedNoEmail: !isEmailConfigured() };
  const nowIso = ctx.now.toISOString();

  // Close out expired RFQs first.
  const { data: closed } = await ctx.db
    .from("govcon_rfqs")
    .update({ status: "no_response" })
    .in("status", ["queued", "sent", "viewed"])
    .lt("quote_due_at", nowIso)
    .select("id");
  stats.closed = closed?.length ?? 0;

  if (!isEmailConfigured()) return stats;

  const { data: rfqs, error } = await ctx.db
    .from("govcon_rfqs")
    .select("*")
    .eq("channel", "email")
    .in("status", ["queued", "sent", "viewed"])
    .gt("quote_due_at", nowIso)
    .limit(200);
  if (error) throw error;
  const due = (rfqs ?? []).filter(
    (r) =>
      r.status === "queued" ||
      (r.followups < MAX_FOLLOWUPS &&
        Date.parse(r.last_followup_at ?? r.sent_at ?? nowIso) + FOLLOWUP_AFTER_MS <= ctx.now.getTime())
  );
  if (!due.length) return stats;

  const subs = await byId<GovconSubcontractorRow>(ctx, "govcon_subcontractors", due.map((r) => r.subcontractor_id));
  const opps = await byId<GovconOpportunityRow>(ctx, "govcon_opportunities", due.map((r) => r.opportunity_id));

  for (const rfq of due) {
    if (timeLeft(ctx) < 20_000) break;
    const sub = subs.get(rfq.subcontractor_id);
    const opp = opps.get(rfq.opportunity_id);
    if (!sub?.email || !opp || sub.do_not_contact || opp.status !== "awaiting_quotes") continue;
    const followup = rfq.status === "queued" ? 0 : rfq.followups + 1;
    try {
      const msg = buildRfqMessage(ctx, rfq, sub, opp, followup);
      await sendEmail({ to: sub.email, subject: msg.subject, text: msg.text, replyTo: ctx.company.email });
      await ctx.db
        .from("govcon_rfqs")
        .update(
          followup === 0
            ? { status: "sent", sent_at: new Date().toISOString(), last_error: null }
            : { followups: followup, last_followup_at: new Date().toISOString() }
        )
        .eq("id", rfq.id);
      if (followup === 0) stats.sent++;
      else stats.followups++;
    } catch (e) {
      stats.failed++;
      await ctx.db.from("govcon_rfqs").update({ status: "failed", last_error: (e as Error).message }).eq("id", rfq.id);
      await logEvent(ctx, opp.id, "error", `RFQ email to ${sub.name} failed: ${(e as Error).message}`);
    }
  }
  if (stats.sent || stats.followups) {
    await logEvent(ctx, null, "outreach", `Sent ${stats.sent} RFQs and ${stats.followups} follow-ups`);
  }
  return stats;
}

export function buildRfqMessage(
  ctx: PipelineContext,
  rfq: GovconRfqRow,
  sub: GovconSubcontractorRow,
  opp: GovconOpportunityRow,
  followup: number
) {
  const analysis = (opp.analysis ?? {}) as Partial<SolicitationAnalysis>;
  const trade = opp.trade ? TRADE_BY_KEY[opp.trade as TradeKey] : null;
  const subcontracting = opp.subcontracting as Partial<SubcontractingAssessment>;
  return rfqEmail({
    company: ctx.company,
    subName: sub.name,
    tradeLabel: trade?.label ?? "facility services",
    location: locationLabel(rowToOpp(opp)) ?? "your area",
    scopeSummary: (analysis.scopeSummary ?? opp.title).slice(0, 600),
    quoteDueAt: rfq.quote_due_at,
    portalUrl: quoteUrl(ctx, rfq.token),
    requiresSmallBusiness: subcontracting.status === "similarly_situated_required",
    wageDetermination: analysis.wageDetermination ?? null,
    followup,
  });
}

async function byId<T extends { id: string }>(
  ctx: PipelineContext,
  table: "govcon_subcontractors" | "govcon_opportunities",
  ids: string[]
): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, T>();
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await ctx.db.from(table).select("*").in("id", unique.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as unknown as T[]) map.set(r.id, r);
  }
  return map;
}
