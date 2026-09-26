import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import {
  sittingsFrom,
  summariseAttention,
  type AttentionEvent,
  type AttentionSummary,
  type Sitting,
} from "@/lib/proposal-attention";
import { objectionById } from "@/lib/objections";
import { outcomeOf, type ObjectionTap } from "@/lib/call-list";

/**
 * What the client read inside one proposal, and what they pressed.
 *
 * The view log says whether they opened it. This says what happened in the
 * open, which is the part an account manager can actually use: somebody who
 * spent ninety seconds on the price and four on the scope is a different
 * phone call from somebody who read the fence area three times.
 *
 * Returns nothing rather than throwing when the table is not there yet, so a
 * job page renders normally on a deployment where the migration has not run.
 * The office sees no panel for a day, which is the right trade for something
 * that is worth having and is not worth a five hundred.
 */

export interface TappedQuestion {
  at: string;
  /** The question as the client saw it. */
  label: string;
  /** What came of it, in words: took the payment plan, said it helped, and so on. */
  outcome: string;
  /** Anything they typed, verbatim. */
  note: string | null;
}

export interface ProposalAttention {
  summary: AttentionSummary;
  /** Every visit, newest first, with when it started and what it was about. */
  sittings: Sitting[];
  /**
   * The questions they tapped at the foot of the proposal, in order.
   *
   * Reading the questions section is one thing; tapping "How did you come
   * up with this price?" is another, and the panel must say which happened.
   */
  questions: TappedQuestion[];
}

const EMPTY: ProposalAttention = {
  summary: { read: [], clicks: [], totalSeconds: 0, focus: null, thin: true },
  sittings: [],
  questions: [],
};

async function questionsFor(filter: { proposalId?: string; jobId?: string }): Promise<TappedQuestion[]> {
  const supabase = await createClient();
  let query = supabase
    .from("proposal_objections")
    .select("objection_id, note, resolution, resolved, raised_at, job_proposals!inner(job_id)")
    .order("raised_at", { ascending: true });
  if (filter.proposalId) query = query.eq("proposal_id", filter.proposalId);
  if (filter.jobId) query = query.eq("job_proposals.job_id", filter.jobId);
  const { data, error } = await query;
  if (error) return [];
  type Row = { objection_id: string; note: string | null; resolution: string | null; resolved: boolean | null; raised_at: string };
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const tap: ObjectionTap = {
      id: row.objection_id,
      at: row.raised_at,
      resolution: row.resolution as ObjectionTap["resolution"],
      resolved: row.resolved,
      note: row.note,
    };
    return {
      at: row.raised_at,
      label: row.objection_id === "other" ? "Something else" : (objectionById(row.objection_id)?.label ?? row.objection_id.replace(/_/g, " ")),
      outcome: row.objection_id === "other" ? (row.note ? "Wrote their own question." : "Opened the box and wrote nothing.") : outcomeOf(tap),
      note: row.note,
    };
  });
}

/** How far back to read. A quote nobody answered in a year is not being read. */
const LIMIT = 2_000;

export async function attentionForProposal(proposalId: string): Promise<ProposalAttention> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_events")
    .select("kind, target, label, seconds, at, visitor_hash")
    .eq("proposal_id", proposalId)
    .order("at", { ascending: true })
    .limit(LIMIT);

  if (error) {
    if (isMissingTable(error)) return EMPTY;
    throw error;
  }

  const events: AttentionEvent[] = (data ?? []).map((row) => ({
    kind: row.kind === "click" ? "click" : "section",
    target: row.target,
    label: row.label,
    seconds: Number(row.seconds) || 0,
    at: row.at,
    visitorHash: row.visitor_hash,
  }));

  return { summary: summariseAttention(events), sittings: sittingsFrom(events), questions: await questionsFor({ proposalId }) };
}

/**
 * The same, reached through the job rather than the proposal.
 *
 * So the job page does not have to wait for its proposal to come back before
 * it can ask what the client read. Row level security already limits this to
 * the caller's own organisation, so joining through the proposal is both
 * cheaper and no wider than asking twice.
 */
export async function attentionForJob(jobId: string): Promise<ProposalAttention> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_events")
    .select("kind, target, label, seconds, at, visitor_hash, job_proposals!inner(job_id)")
    .eq("job_proposals.job_id", jobId)
    .order("at", { ascending: true })
    .limit(LIMIT);

  if (error) {
    if (isMissingTable(error)) return EMPTY;
    throw error;
  }

  const events: AttentionEvent[] = (data ?? []).map((row) => ({
    kind: row.kind === "click" ? "click" : "section",
    target: row.target,
    label: row.label,
    seconds: Number(row.seconds) || 0,
    at: row.at,
    visitorHash: row.visitor_hash,
  }));

  return { summary: summariseAttention(events), sittings: sittingsFrom(events), questions: await questionsFor({ jobId }) };
}

/**
 * Every proposal's attention, in one query.
 *
 * Takes no ids for the same reason the view log's version does not: the list
 * page would otherwise wait for its proposals to come back before it could
 * ask, which is a round trip spent doing nothing. Row level security already
 * limits this to the caller's own organisation, so asking for all of them is
 * both cheaper and no wider.
 */
export async function attentionForAllProposals(): Promise<Record<string, AttentionSummary>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_events")
    .select("proposal_id, kind, target, label, seconds, at, visitor_hash")
    .order("at", { ascending: true })
    .limit(LIMIT * 5);

  if (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }

  const grouped = new Map<string, AttentionEvent[]>();
  for (const row of data ?? []) {
    const list = grouped.get(row.proposal_id) ?? [];
    list.push({
      kind: row.kind === "click" ? "click" : "section",
      target: row.target,
      label: row.label,
      seconds: Number(row.seconds) || 0,
      at: row.at,
      visitorHash: row.visitor_hash,
    });
    grouped.set(row.proposal_id, list);
  }

  const out: Record<string, AttentionSummary> = {};
  for (const [proposalId, events] of grouped) out[proposalId] = summariseAttention(events);
  return out;
}

/** What a proposal nobody has read yet looks like. */
export const NO_ATTENTION: AttentionSummary = EMPTY.summary;
