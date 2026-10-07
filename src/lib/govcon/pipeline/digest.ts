import { isEmailConfigured, sendEmail } from "../email";
import type { PipelineContext } from "./context";

/**
 * Daily summary to the owner: what's ready to submit, who to call, and
 * proposal volume against the monthly target (the win rate is ~5-10%, so
 * volume is the whole game).
 */
export async function digest(ctx: PipelineContext) {
  const monthStart = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1)).toISOString();
  const [ready, awaiting, calls, submitted, won] = await Promise.all([
    ctx.db.from("govcon_opportunities").select("id, title, response_deadline").eq("status", "ready").order("response_deadline"),
    ctx.db.from("govcon_opportunities").select("id", { count: "exact", head: true }).eq("status", "awaiting_quotes"),
    ctx.db.from("govcon_rfqs").select("id", { count: "exact", head: true }).eq("channel", "call").eq("status", "queued"),
    ctx.db.from("govcon_bids").select("id", { count: "exact", head: true }).gte("submitted_at", monthStart),
    ctx.db.from("govcon_opportunities").select("id", { count: "exact", head: true }).eq("status", "won"),
  ]);
  const stats = {
    ready: ready.data?.length ?? 0,
    awaitingQuotes: awaiting.count ?? 0,
    callList: calls.count ?? 0,
    submittedThisMonth: submitted.count ?? 0,
    target: ctx.profile.monthlyProposalTarget,
    wonAllTime: won.count ?? 0,
  };
  if (!isEmailConfigured() || !ctx.company.email) return { ...stats, emailed: false };

  const lines = [
    `Proposals submitted this month: ${stats.submittedThisMonth} / ${stats.target}`,
    `Bids ready for your review: ${stats.ready}`,
    ...(ready.data ?? []).map((o) => `  • ${o.title} (due ${o.response_deadline?.slice(0, 10)}) — ${ctx.appUrl}/govcon/opportunities/${o.id}`),
    `Opportunities waiting on sub quotes: ${stats.awaitingQuotes}`,
    `Subs to call (no email found): ${stats.callList} — ${ctx.appUrl}/govcon/calls`,
    `Contracts won: ${stats.wonAllTime}`,
    "",
    `Dashboard: ${ctx.appUrl}/govcon`,
  ];
  await sendEmail({ to: ctx.company.email, subject: `Govcon daily: ${stats.ready} bid(s) ready, ${stats.submittedThisMonth}/${stats.target} submitted this month`, text: lines.join("\n") });
  return { ...stats, emailed: true };
}
