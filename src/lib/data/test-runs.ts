import { createClient } from "@/lib/supabase/server";
import { readTiers, tierById } from "@/lib/evaluation-tiers";
import { readTapSpots } from "@/lib/tap-estimate";
import { summarizeRun, type RunInput, type TestRun } from "@/lib/test-runs";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

const MAX_RUNS = 300;

/**
 * Every test run of the booking funnel for the signed-in user's business,
 * newest first. Read as that user, so row security keeps it to their
 * business. Anything that couldn't be read is said, not hidden.
 */
export async function getTestRuns(): Promise<{ runs: TestRun[]; problems: string[] }> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const problems: string[] = [];

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, job_number, created_at, property:properties(address, customer:customers(name, email, phone))")
    .eq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(MAX_RUNS);
  if (error) return { runs: [], problems: [`Test runs couldn't be read (has migration 0387 been run?): ${error.message}`] };
  if (!jobs || jobs.length === 0) return { runs: [], problems };

  const ids = jobs.map((j) => j.id);
  const [estimates, intakes, steps, org] = await Promise.all([
    supabase
      .from("job_estimates")
      .select("job_id, spots, sizing, total_cents, deposit_cents, choice, evaluation_tier, charged_cents, start_day, test_visit_at, created_at, updated_at")
      .in("job_id", ids),
    supabase.from("evaluation_intakes").select("job_id, token, photo_outdated_at, wrong_property_at").in("job_id", ids),
    supabase.from("funnel_events").select("job_id, step, created_at").in("job_id", ids).limit(10_000),
    supabase.from("organizations").select("evaluation_tiers").eq("id", organizationId).maybeSingle(),
  ]);
  if (estimates.error) problems.push(`Estimates couldn't be read: ${estimates.error.message}`);
  if (intakes.error) problems.push(`The map forms couldn't be read: ${intakes.error.message}`);
  if (steps.error) problems.push(`The steps they took couldn't be read: ${steps.error.message}`);

  const tiers = readTiers(org.data?.evaluation_tiers);
  const estimateBy = new Map((estimates.data ?? []).map((e) => [e.job_id, e]));
  const intakeBy = new Map((intakes.data ?? []).map((i) => [i.job_id, i]));
  const stepsBy = new Map<string, { step: string; at: string }[]>();
  for (const s of steps.data ?? []) {
    if (!s.job_id) continue;
    stepsBy.set(s.job_id, [...(stepsBy.get(s.job_id) ?? []), { step: s.step, at: s.created_at }]);
  }

  const runs = jobs.map((job) => {
    const property = job.property as unknown as { address: string | null; customer: { name: string | null; email: string | null; phone: string | null } | null } | null;
    const e = estimateBy.get(job.id);
    const intake = intakeBy.get(job.id);
    const input: RunInput = {
      jobId: job.id,
      jobNumber: job.job_number,
      createdAt: job.created_at,
      customer: property?.customer ?? { name: null, email: null, phone: null },
      address: property?.address ?? null,
      token: intake?.token ?? null,
      photoFlag: intake?.wrong_property_at ? "wrong_property" : intake?.photo_outdated_at ? "outdated" : null,
      estimate: e
        ? {
            spots: readTapSpots(e.spots),
            sizing: e.sizing,
            totalCents: e.total_cents,
            depositCents: e.deposit_cents,
            choice: e.choice,
            tierName: e.evaluation_tier ? (tierById(tiers, e.evaluation_tier)?.name ?? e.evaluation_tier) : null,
            chargedCents: e.charged_cents,
            startDay: e.start_day,
            testVisitAt: e.test_visit_at,
            createdAt: e.created_at,
            updatedAt: e.updated_at,
          }
        : null,
      steps: stepsBy.get(job.id) ?? [],
    };
    return summarizeRun(input);
  });
  return { runs, problems };
}
