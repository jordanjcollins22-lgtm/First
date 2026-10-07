import { analyze } from "./analyze";
import { createContext, type PipelineContext } from "./context";
import { digest } from "./digest";
import { discover } from "./discover";
import { importEntities } from "./entities";
import { estimate } from "./estimate";
import { evaluate } from "./evaluate";
import { outreach } from "./outreach";
import { source } from "./source";

export type Stage = "discover" | "process" | "digest" | "entities" | "all";

/**
 * Run pipeline stages within a time budget and record the run.
 *  - discover: ingest + score new notices (daily, after SAM's ~03:30 UTC rebuild)
 *  - process:  analyze → source subs → send RFQs → evaluate quotes (hourly)
 *  - digest:   owner summary email (daily)
 *  - entities: SAM registered-business import for local sub search (monthly)
 */
export async function runPipeline(stage: Stage, budgetMs: number) {
  const ctx = await createContext(budgetMs);
  const { data: run } = await ctx.db.from("govcon_runs").insert({ stage }).select("id").single();
  const results: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    if (stage === "discover" || stage === "all") results.discover = await discover(ctx);
    if (stage === "process" || stage === "all") Object.assign(results, await processStages(ctx));
    if (stage === "digest" || stage === "all") results.digest = await digest(ctx);
    if (stage === "entities") results.entities = await importEntities(ctx);
  } catch (e) {
    error = (e as Error).message;
  }
  if (run) {
    await ctx.db
      .from("govcon_runs")
      .update({ finished_at: new Date().toISOString(), ok: !error, stats: results, error })
      .eq("id", run.id);
  }
  return { ok: !error, error, results };
}

async function processStages(ctx: PipelineContext) {
  // Order matters: later stages consume what earlier ones produce, and
  // outreach goes before analysis so time-sensitive emails never starve.
  const outreachStats = await outreach(ctx);
  const evaluateStats = await evaluate(ctx, 10);
  const estimateStats = await estimate(ctx);
  const analyzeStats = await analyze(ctx, 10);
  const sourceStats = await source(ctx, 10);
  const outreachAfter = await outreach(ctx); // send RFQs just created
  return { outreach: outreachStats, evaluate: evaluateStats, estimate: estimateStats, analyze: analyzeStats, source: sourceStats, outreachAfter };
}
