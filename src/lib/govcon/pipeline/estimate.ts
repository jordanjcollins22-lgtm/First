import { priorityScore } from "../goals";
import { anchorFromComparables, findComparableAwards } from "../sources/usaspending";
import { logEvent, rowToOpp, timeLeft, type PipelineContext } from "./context";

/**
 * Stage 1b — cheap value estimate for every new match (USAspending only, no
 * AI): what did comparable work pay per year? That feeds the queue priority
 * so the limited daily document reads go to the contracts that move revenue.
 */
export async function estimate(ctx: PipelineContext, limit = 40) {
  const stats = { estimated: 0, withAnchor: 0 };
  const { data: rows, error } = await ctx.db
    .from("govcon_opportunities")
    .select("*")
    .eq("status", "new")
    .is("estimated_at", null)
    .gt("response_deadline", ctx.now.toISOString())
    .order("score", { ascending: false })
    .limit(limit);
  if (error) throw error;

  for (const row of rows ?? []) {
    if (timeLeft(ctx) < 120_000) break;
    const opp = rowToOpp(row);
    const comparables = await findComparableAwards(opp, ctx.now).catch(() => []);
    const anchor = anchorFromComparables(comparables);
    const expected = row.estimated_value ?? anchor?.annualAmount ?? null;
    await ctx.db
      .from("govcon_opportunities")
      .update({
        comparables: comparables.slice(0, 10),
        price_anchor: anchor,
        expected_annual_value: expected,
        priority: priorityScore(row.score, expected),
        estimated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    stats.estimated++;
    if (anchor) stats.withAnchor++;
  }
  if (stats.estimated) await logEvent(ctx, null, "estimate", `Estimated contract value for ${stats.estimated} new matches (${stats.withAnchor} with price history)`);
  return stats;
}
