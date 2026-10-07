import type { SolicitationAnalysis } from "./ai";
import type { Db } from "./pipeline/context";

/**
 * Turn a win into a tracked contract so it counts toward the revenue
 * run-rate. Period comes from the solicitation analysis when we have it;
 * values can be corrected on the Contracts page.
 */
export function contractTerms(input: {
  totalValue: number;
  subCost: number;
  analysis: Partial<SolicitationAnalysis> | null;
  now?: Date;
}) {
  const pop = input.analysis?.periodOfPerformance;
  const baseMonths = pop?.baseMonths ?? 12;
  const years = Math.max(1 / 12, baseMonths / 12 + (pop?.optionPeriods ?? 0));
  const start = pop?.startDate && !Number.isNaN(Date.parse(pop.startDate)) ? new Date(pop.startDate) : new Date((input.now ?? new Date()).getTime() + 30 * 86_400_000);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + Math.round(years * 12));
  return {
    total_value: input.totalValue,
    annual_value: Math.round(input.totalValue / Math.max(1, years)),
    sub_annual_cost: Math.round(input.subCost / Math.max(1, years)),
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

export async function createContractFromWin(db: Db, opportunityId: string, awardAmount?: number | null) {
  const [{ data: opp }, { data: bid }] = await Promise.all([
    db.from("govcon_opportunities").select("analysis").eq("id", opportunityId).single(),
    db.from("govcon_bids").select("id, price, sub_cost, quote_id").eq("opportunity_id", opportunityId).maybeSingle(),
  ]);
  let subcontractorId: string | null = null;
  if (bid?.quote_id) {
    const { data: q } = await db.from("govcon_quotes").select("subcontractor_id").eq("id", bid.quote_id).maybeSingle();
    subcontractorId = q?.subcontractor_id ?? null;
  }
  const terms = contractTerms({
    totalValue: Number(awardAmount ?? bid?.price ?? 0),
    subCost: Number(bid?.sub_cost ?? 0),
    analysis: (opp?.analysis ?? null) as Partial<SolicitationAnalysis> | null,
  });
  await db
    .from("govcon_contracts")
    .upsert({ opportunity_id: opportunityId, bid_id: bid?.id ?? null, subcontractor_id: subcontractorId, status: "active", ...terms }, { onConflict: "opportunity_id" });
}
