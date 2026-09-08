import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { needsAttention, type Issue, type IssueSeverity, type BlockingStage } from "@/lib/issues";
import { evaluateGate, type GateOverride } from "@/lib/readiness";
import { jobFacts } from "@/lib/data/issues";
import type { BoardJob } from "@/lib/job-board";

export interface JobStanding {
  /** Sold work with every blocking pre-start check passing. */
  ready: Set<string>;
  /** Anything with an unresolved blocking or critical issue on it. */
  attention: Set<string>;
  /** What is stopping each job, for the row. */
  line: Map<string, string>;
}

interface IssueRow {
  id: string;
  job_id: string;
  severity: string;
  status: string;
  blocking: boolean;
  blocking_stage: string | null;
}

/**
 * Which jobs are Ready and which need attention, for the board.
 *
 * Needs attention is one read of the open issues, so it costs nothing. Ready
 * needs the facts of each job, which is several reads apiece -- so it is only
 * computed for the sold work that could possibly be ready, and never for a job
 * that is finished or still being quoted.
 */
export async function jobStanding(jobs: readonly BoardJob[]): Promise<JobStanding> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  const { data: issueData } = await supabase
    .from("job_issues")
    .select("id, job_id, severity, status, blocking, blocking_stage")
    .eq("organization_id", org)
    .eq("status", "open")
    .limit(1000);

  const byJob = new Map<string, Issue[]>();
  for (const row of ((issueData ?? []) as unknown as IssueRow[])) {
    // Only the fields the judgment reads; the rest is for the job page.
    const issue = {
      id: row.id,
      jobId: row.job_id,
      severity: row.severity as IssueSeverity,
      status: row.status as Issue["status"],
      blocking: row.blocking,
      blockingStage: (row.blocking_stage as BlockingStage | null) ?? null,
    } as Issue;
    const list = byJob.get(row.job_id) ?? [];
    list.push(issue);
    byJob.set(row.job_id, list);
  }

  const attention = new Set<string>();
  for (const [jobId, issues] of byJob) {
    if (needsAttention(issues)) attention.add(jobId);
  }

  const candidates = jobs.filter((job) => job.status === "approved");
  const { data: overrideData } = await supabase
    .from("job_gate_overrides")
    .select("job_id, gate, check_key, reason, overridden_by, overridden_at")
    .eq("organization_id", org)
    .eq("gate", "ready")
    .is("withdrawn_at", null)
    .limit(1000);

  const overridesByJob = new Map<string, GateOverride[]>();
  for (const row of ((overrideData ?? []) as unknown as {
    job_id: string;
    check_key: string;
    reason: string;
    overridden_by: string | null;
    overridden_at: string;
  }[])) {
    const list = overridesByJob.get(row.job_id) ?? [];
    list.push({
      checkKey: row.check_key,
      reason: row.reason,
      byId: row.overridden_by,
      byName: null,
      at: row.overridden_at,
    });
    overridesByJob.set(row.job_id, list);
  }

  const ready = new Set<string>();
  const line = new Map<string, string>();
  for (const job of candidates) {
    const facts = await jobFacts(job.id).catch(() => null);
    if (!facts) continue;
    const result = evaluateGate("ready", facts, byJob.get(job.id) ?? [], overridesByJob.get(job.id) ?? []);
    if (result.open) ready.add(job.id);
    else {
      const bits: string[] = [];
      if (result.stoppers.length > 0) bits.push(result.stoppers.map((c) => c.label).join(", "));
      if (result.blockingIssues.length > 0) {
        bits.push(`${result.blockingIssues.length} blocking ${result.blockingIssues.length === 1 ? "issue" : "issues"}`);
      }
      line.set(job.id, `Waiting on: ${bits.join(" · ")}`);
    }
  }

  return { ready, attention, line };
}
