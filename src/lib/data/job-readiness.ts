import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { type Issue, type IssueSeverity, type BlockingStage } from "@/lib/issues";
import { evaluateGate, type GateOverride } from "@/lib/readiness";
import { jobFacts, jobInvoicedAt } from "@/lib/data/issues";
import { attentionReasons, type AttentionReason } from "@/lib/attention";
import { jobsWithOpenExceptions, type ExceptionLoad } from "@/lib/data/exceptions";
import type { BoardJob } from "@/lib/job-board";

export interface JobStanding {
  /** Sold work with every applicable blocking pre-start check passing. */
  ready: Set<string>;
  /** Anything an issue or a derived reason says wants looking at. */
  attention: Set<string>;
  /** What is stopping each job from being ready, for the row. */
  line: Map<string, string>;
  /** Why each job is in Needs attention, in the words somebody would use. */
  why: Map<string, AttentionReason[]>;
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
  const why = new Map<string, AttentionReason[]>();
  const attention = new Set<string>();
  const now = new Date().toISOString();

  // Every job that could be ready, plus every job an issue already names, plus
  // finished work that might still be owed for. Nothing else needs its facts
  // read, and reading them is several queries a job.
  // One read for the whole organisation rather than a query a job: what the
  // field has reported and what is waiting on a desk.
  const load: Map<string, ExceptionLoad> = await jobsWithOpenExceptions().catch(() => new Map());

  const worthAsking = new Set<string>([
    ...candidates.map((job) => job.id),
    ...byJob.keys(),
    ...load.keys(),
    ...jobs.filter((job) => job.status === "completed").map((job) => job.id),
  ]);

  // Asked together rather than one after another. Each job's facts are about
  // ten reads, and in series that is the page sitting there while a hundred
  // round trips go out one at a time.
  const asked = jobs.filter((job) => worthAsking.has(job.id));
  const gathered = await Promise.all(
    asked.map(async (job) => ({
      job,
      facts: await jobFacts(job.id).catch(() => null),
      invoicedAt: await jobInvoicedAt(job.id).catch(() => null),
    }))
  );

  for (const { job, facts, invoicedAt } of gathered) {
    if (!facts) continue;
    const issues = byJob.get(job.id) ?? [];

    const result = evaluateGate("ready", facts, issues, overridesByJob.get(job.id) ?? []);
    const isReadyNow = job.status === "approved" && result.open;
    if (isReadyNow) ready.add(job.id);
    else if (job.status === "approved") {
      const bits: string[] = [];
      if (result.stoppers.length > 0) bits.push(result.stoppers.map((c) => c.label).join(", "));
      if (result.blockingIssues.length > 0) {
        bits.push(`${result.blockingIssues.length} blocking ${result.blockingIssues.length === 1 ? "issue" : "issues"}`);
      }
      if (bits.length > 0) line.set(job.id, `Waiting on: ${bits.join(" · ")}`);
    }

    const closeout = evaluateGate("closeout", facts, issues, []);
    const reasons = attentionReasons(
      {
        status: facts.status,
        startsOn: job.startsOn,
        ready: isReadyNow,
        completedAt: job.completedAt,
        closeoutDone: closeout.open,
        balanceOutstanding: facts.balanceOutstanding,
        invoicedAt: facts.invoiceRaised ? invoicedAt : null,
        financialDisposition: facts.financialDisposition,
        crewStopped: load.get(job.id)?.blocking ?? 0,
        openExceptions: load.get(job.id)?.open ?? 0,
        changesAwaitingReview: load.get(job.id)?.awaitingReview ?? 0,
        changesAwaitingClient: load.get(job.id)?.awaitingClient ?? 0,
        oldestSentToClientAt: load.get(job.id)?.oldestSentToClientAt ?? null,
      },
      issues,
      now
    );
    if (reasons.length > 0) {
      attention.add(job.id);
      why.set(job.id, reasons);
    }
  }

  return { ready, attention, line, why };
}
