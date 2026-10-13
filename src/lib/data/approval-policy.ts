import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import {
  decideHold,
  defaultModeFor,
  isApprovalMode,
  KNOWN_KINDS,
  type ApprovalMode,
  type HoldDecision,
} from "@/lib/approvals/policy";
import { duplicateBookings, mootReason, type MootJob, type MootReason } from "@/lib/approvals/moot";

/**
 * The approval policy and the "is this still worth sending" check, read
 * from the database. Every caller that writes an automatic email asks here
 * first, so the per-kind policy and the trigger fixes live in one place.
 *
 * Runs as the service role: the callers are crons and webhooks.
 */

// The new tables are not in database.types.ts yet, so the client is cast.
type Loose = SupabaseClient;
function loose(client: unknown): Loose {
  return client as Loose;
}

export interface PolicyState {
  masterHold: boolean;
  modes: Map<string, ApprovalMode>;
  policyStartedAt: string | null;
  digestEnabled: boolean;
  digestStartedAt: string | null;
  digestLastSentAt: string | null;
}

export async function loadPolicy(client: unknown, organizationId: string): Promise<PolicyState> {
  const db = loose(client);
  const [{ data: org }, { data: rows }, { data: settings }] = await Promise.all([
    db.from("organizations").select("require_email_approval").eq("id", organizationId).maybeSingle(),
    db.from("email_approval_policy").select("kind, mode").eq("organization_id", organizationId),
    db
      .from("approval_settings")
      .select("policy_started_at, digest_enabled, digest_started_at, digest_last_sent_at")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  const modes = new Map<string, ApprovalMode>();
  for (const row of (rows ?? []) as { kind: string; mode: string }[]) {
    if (isApprovalMode(row.mode)) modes.set(row.kind, row.mode);
  }
  const s = settings as { policy_started_at: string | null; digest_enabled: boolean | null; digest_started_at: string | null; digest_last_sent_at: string | null } | null;
  return {
    masterHold: Boolean((org as { require_email_approval?: boolean } | null)?.require_email_approval),
    modes,
    policyStartedAt: s?.policy_started_at ?? null,
    digestEnabled: s?.digest_enabled ?? true,
    digestStartedAt: s?.digest_started_at ?? null,
    digestLastSentAt: s?.digest_last_sent_at ?? null,
  };
}

/** Every kind worth listing on the settings screen, with what it does now. */
export function policyRows(state: PolicyState): { kind: string; mode: ApprovalMode; isDefault: boolean }[] {
  const kinds = [...new Set([...KNOWN_KINDS, ...state.modes.keys()])];
  return kinds.map((kind) => ({ kind, mode: state.modes.get(kind) ?? defaultModeFor(kind), isDefault: !state.modes.has(kind) }));
}

/**
 * Whether this kind has gone out from this business before, in its current
 * wording. A person approving one counts; so does one that went on its own.
 * An evaluation step whose wording was edited after it last went is new
 * again. Null when the history could not be read.
 */
export async function isFirstSend(client: unknown, organizationId: string, kind: string): Promise<boolean | null> {
  const db = loose(client);
  try {
    const [{ data: approved }, { data: logged }] = await Promise.all([
      db
        .from("outbound_approvals")
        .select("sent_at")
        .eq("organization_id", organizationId)
        .eq("kind", kind)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1),
      // A log row says "sent" from the moment it is claimed, so only one
      // with a provider id or a thread behind it is proof it actually went.
      db
        .from("client_message_log")
        .select("created_at")
        .eq("organization_id", organizationId)
        .eq("kind", kind)
        .eq("channel", "email")
        .eq("status", "sent")
        .or("provider_id.not.is.null,detail.like.thread:%")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const times = [
      ((approved ?? []) as { sent_at: string | null }[])[0]?.sent_at ?? null,
      ((logged ?? []) as { created_at: string }[])[0]?.created_at ?? null,
    ].filter((t): t is string => Boolean(t));
    if (times.length === 0) return true;
    const lastSent = times.sort().at(-1)!;

    if (kind.startsWith("evaluation_")) {
      const step = kind.slice("evaluation_".length);
      const { data: template } = await db
        .from("evaluation_sequence_steps")
        .select("updated_at")
        .eq("organization_id", organizationId)
        .eq("step", step)
        .maybeSingle();
      const edited = (template as { updated_at: string } | null)?.updated_at;
      if (edited && edited > lastSent) return true;
    }
    return false;
  } catch (err) {
    log.warn("approvals.first_send_unreadable", { organizationId, kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Whether one automatic email waits for the owner, under this business's
 * policy. The first-send check is only made when it could change the answer.
 */
export async function holdDecisionFor(
  client: unknown,
  input: { organizationId: string; kind: string; aiWritten?: boolean; teamRequest?: boolean; state?: PolicyState }
): Promise<HoldDecision> {
  const state = input.state ?? (await loadPolicy(client, input.organizationId));
  const base = {
    masterHold: state.masterHold,
    kind: input.kind,
    storedMode: state.modes.get(input.kind) ?? null,
    aiWritten: input.aiWritten,
    teamRequest: input.teamRequest,
  };
  const quick = decideHold({ ...base, firstSend: false });
  // Already held for a reason a first send cannot change, or a kind that
  // only matters if it is new.
  if (quick.hold) return quick;
  const firstSend = await isFirstSend(client, input.organizationId, input.kind);
  return decideHold({ ...base, firstSend });
}

/** The email kinds whose moot check needs the job behind them. */
function needsJob(kind: string): boolean {
  return kind.startsWith("evaluation_") || kind === "job_start_reminder";
}

/**
 * Why one automatic email should not go, or null when it should.
 *
 * Reads the job, its proposal and calls, and any second booking of the same
 * visit. A handful of narrow queries, only for the kinds that have a rule.
 */
export async function mootFor(
  client: unknown,
  input: {
    organizationId: string;
    kind: string;
    /** The job for evaluation and job emails. */
    jobId?: string | null;
    /** The proposal for a proposal follow-up. */
    proposalId?: string | null;
    writtenForEvaluationAt?: string | null;
    now?: Date;
  }
): Promise<MootReason | null> {
  const db = loose(client);
  const now = input.now ?? new Date();
  try {
    if (input.kind === "proposal_follow_up") {
      if (!input.proposalId) return null;
      const { data: p } = await db
        .from("job_proposals")
        .select("id, status, sent_at, job_id, job:jobs(id, status, evaluation_status, cancelled_at, evaluation_date, completed_at)")
        .eq("id", input.proposalId)
        .maybeSingle();
      const proposal = p as {
        status: string;
        sent_at: string | null;
        job_id: string;
        job: { id: string; status: string | null; evaluation_status: string | null; cancelled_at: string | null; evaluation_date: string | null; completed_at: string | null } | null;
      } | null;
      if (!proposal) return null;
      let calls = 0;
      if (proposal.sent_at) {
        const { count } = await db
          .from("proposal_calls")
          .select("id", { count: "exact", head: true })
          .eq("job_id", proposal.job_id)
          .gte("created_at", proposal.sent_at);
        calls = count ?? 0;
      }
      return mootReason(
        {
          kind: input.kind,
          job: proposal.job ? toMootJob(proposal.job) : null,
          proposal: { status: proposal.status, sentAt: proposal.sent_at },
          callsSinceSent: calls,
        },
        now
      );
    }

    if (!needsJob(input.kind) || !input.jobId) return null;
    const { data: j } = await db
      .from("jobs")
      .select("id, status, evaluation_status, cancelled_at, evaluation_date, completed_at, created_at, duplicate_cleared_at, property:properties(customer:customers(email))")
      .eq("id", input.jobId)
      .maybeSingle();
    const job = j as (JobRow & { property: { customer: { email: string | null } | null } | null }) | null;
    if (!job) return null;

    let proposal: { status: string; sentAt: string | null } | null = null;
    if (input.kind === "evaluation_after") {
      const { data: p } = await db.from("job_proposals").select("status, sent_at").eq("job_id", job.id).maybeSingle();
      const row = p as { status: string; sent_at: string | null } | null;
      proposal = row ? { status: row.status, sentAt: row.sent_at } : null;
    }

    let duplicateOf: string | null = null;
    const email = job.property?.customer?.email?.trim();
    if (input.kind.startsWith("evaluation_") && email && job.evaluation_date) {
      duplicateOf = await duplicateOfJob(db, input.organizationId, job, email);
    }

    return mootReason(
      { kind: input.kind, job: toMootJob(job), writtenForEvaluationAt: input.writtenForEvaluationAt ?? null, proposal, duplicateOf },
      now
    );
  } catch (err) {
    // A check that cannot be made does not stop the email: the old path
    // sent it, and the consent rules still apply downstream.
    log.warn("approvals.moot_unreadable", { kind: input.kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

interface JobRow {
  id: string;
  status: string | null;
  evaluation_status: string | null;
  cancelled_at: string | null;
  evaluation_date: string | null;
  completed_at: string | null;
  created_at?: string;
  duplicate_cleared_at?: string | null;
}

function toMootJob(row: JobRow): MootJob {
  return {
    id: row.id,
    status: row.status,
    evaluationStatus: row.evaluation_status,
    cancelledAt: row.cancelled_at,
    evaluationDate: row.evaluation_date,
    completedAt: row.completed_at,
  };
}

/** The earlier booking of the same visit by the same person, if this is a copy. */
async function duplicateOfJob(db: Loose, organizationId: string, job: JobRow, email: string): Promise<string | null> {
  const at = new Date(job.evaluation_date!).getTime();
  const { data } = await db
    .from("jobs")
    .select("id, status, evaluation_status, cancelled_at, evaluation_date, created_at, duplicate_cleared_at, property:properties!inner(customer:customers!inner(email, organization_id))")
    .eq("property.customer.organization_id", organizationId)
    .ilike("property.customer.email", email)
    .gte("evaluation_date", new Date(at - 3 * 60 * 60 * 1000).toISOString())
    .lte("evaluation_date", new Date(at + 3 * 60 * 60 * 1000).toISOString())
    .limit(10);
  const rows = (data ?? []) as unknown as (JobRow & { property: { customer: { email: string | null } } })[];
  const copies = duplicateBookings(
    rows.map((r) => ({
      id: r.id,
      email: r.property.customer.email,
      evaluationDate: r.evaluation_date,
      createdAt: r.created_at ?? "",
      cancelled: Boolean(r.cancelled_at) || r.status === "cancelled" || r.evaluation_status === "cancelled",
      duplicateClearedAt: r.duplicate_cleared_at ?? null,
    }))
  );
  return copies.get(job.id) ?? null;
}
