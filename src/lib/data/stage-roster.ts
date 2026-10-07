import { createClient } from "@/lib/supabase/server";
import { SYSTEM_FLOW } from "@/lib/system-flow";
import type { SequenceMessage } from "@/lib/client-message-sequence";
import { sequenceKeyFromDedupe, stageRoster, type RosterPersonInput, type RosterRow } from "@/lib/stage-roster";

export interface StageRoster {
  rows: RosterRow[];
  /** The step they move on to once this one is done. */
  nextStep: string | null;
  /** Who counts as being at this step, in a sentence. */
  who: string;
}

type JobRow = {
  id: string;
  status: string;
  created_at: string;
  evaluation_date: string | null;
  evaluation_status: string | null;
  project_start_date: string | null;
  completed_at: string | null;
  properties: { customers: { name: string | null } | null } | null;
  job_proposals: { id: string; status: string; sent_at: string | null }[] | { id: string; status: string; sent_at: string | null } | null;
};

const JOB_COLUMNS = "id, status, created_at, evaluation_date, evaluation_status, project_start_date, completed_at, properties(customers(name)), job_proposals(id, status, sent_at)";

/**
 * Everybody at one step of The system now, each with the last of this
 * step's messages they got and the next one due. Which jobs count as being
 * at a step is read from the job itself: a visit still to come is at the
 * booking, a visit just done with no proposal out is at the evaluation, an
 * unanswered proposal is at pricing, a sold job not started is at the crew
 * sheet, and a job just finished is at the client's approval.
 */
export async function getStageRoster(square: string, messages: SequenceMessage[], now: Date = new Date()): Promise<StageRoster> {
  const supabase = await createClient();
  const nowIso = now.toISOString();
  const day = 86_400_000;
  const proposalOf = (j: JobRow) => (Array.isArray(j.job_proposals) ? (j.job_proposals[0] ?? null) : j.job_proposals);

  let jobs: JobRow[] = [];
  let who = "";
  if (square === "booking") {
    const { data } = await supabase.from("jobs").select(JOB_COLUMNS).gte("evaluation_date", nowIso).neq("status", "cancelled").order("evaluation_date").limit(200);
    jobs = ((data ?? []) as unknown as JobRow[]).filter((j) => j.evaluation_status !== "cancelled" && j.evaluation_status !== "completed");
    who = "Everyone with an evaluation visit still to come.";
  } else if (square === "evaluation") {
    const { data } = await supabase
      .from("jobs")
      .select(JOB_COLUMNS)
      .lt("evaluation_date", nowIso)
      .gte("evaluation_date", new Date(now.getTime() - 7 * day).toISOString())
      .neq("status", "cancelled")
      .limit(200);
    jobs = ((data ?? []) as unknown as JobRow[]).filter((j) => j.evaluation_status !== "cancelled" && !proposalOf(j)?.sent_at);
    who = "Everyone visited in the last week whose proposal hasn't gone out yet.";
  } else if (square === "pricing") {
    const { data } = await supabase.from("jobs").select(JOB_COLUMNS).neq("status", "cancelled").limit(500);
    jobs = ((data ?? []) as unknown as JobRow[]).filter((j) => {
      const p = proposalOf(j);
      return p?.status === "sent" && p.sent_at;
    });
    who = "Everyone with a proposal out and no answer yet.";
  } else if (square === "crew-sheet") {
    const { data } = await supabase.from("jobs").select(JOB_COLUMNS).in("status", ["approved", "in_progress"]).gte("project_start_date", nowIso.slice(0, 10)).limit(200);
    jobs = (data ?? []) as unknown as JobRow[];
    who = "Everyone sold with a start date still to come.";
  } else if (square === "client-approval") {
    const { data } = await supabase.from("jobs").select(JOB_COLUMNS).eq("status", "completed").gte("completed_at", new Date(now.getTime() - 14 * day).toISOString()).limit(200);
    jobs = (data ?? []) as unknown as JobRow[];
    who = "Everyone whose job finished in the last two weeks.";
  }

  const jobIds = jobs.map((j) => j.id);
  const proposalJob = new Map<string, string>();
  for (const j of jobs) {
    const p = proposalOf(j);
    if (p) proposalJob.set(p.id, j.id);
  }
  const refs = [...jobIds, ...proposalJob.keys()];
  const { data: logs } = refs.length
    ? await supabase.from("client_message_log").select("reference_id, dedupe_key, created_at").eq("status", "sent").in("reference_id", refs)
    : { data: [] };

  const sentByJob = new Map<string, Map<string, string>>();
  for (const log of (logs ?? []) as { reference_id: string; dedupe_key: string; created_at: string }[]) {
    const key = sequenceKeyFromDedupe(log.dedupe_key);
    if (!key) continue;
    const jobId = proposalJob.get(log.reference_id) ?? log.reference_id;
    const map = sentByJob.get(jobId) ?? new Map<string, string>();
    if (!map.has(key) || log.created_at > map.get(key)!) map.set(key, log.created_at);
    sentByJob.set(jobId, map);
  }

  const people: RosterPersonInput[] = jobs.map((j) => ({
    jobId: j.id,
    client: j.properties?.customers?.name ?? "Client",
    anchors: {
      bookedAt: j.created_at,
      visitAt: j.evaluation_date,
      proposalSentAt: proposalOf(j)?.sent_at ?? null,
      // Start dates are days; the crew is out around 8am Eastern.
      jobStartAt: j.project_start_date ? `${j.project_start_date.slice(0, 10)}T12:00:00.000Z` : null,
    },
    sent: sentByJob.get(j.id) ?? new Map(),
  }));

  const squares = SYSTEM_FLOW.filter((s) => s.key !== "marketing").flatMap((s) => s.squares);
  const at = squares.findIndex((s) => s.key === square);
  return { rows: stageRoster(messages, people, now), nextStep: at >= 0 && at + 1 < squares.length ? squares[at + 1].title : null, who };
}
