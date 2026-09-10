import { createClient } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/setup-errors";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { NO_VIEWS, viewsForAllProposals } from "@/lib/data/proposal-views";
import { boundedPageSize } from "@/lib/pagination";
import { activityLabel, isWarm, type ViewSummary } from "@/lib/proposal-views";
import type { JobProposal } from "@/types/domain";

/**
 * The part of a proposal this list draws, and nothing else.
 *
 * A proposal row is a name, an address, a date, a price, a status and the
 * buttons that act on it. Everything else on the record — the discount
 * breakdown, the site image and its transform, the payment path, the Stripe
 * session, every timestamp the client's own journey wrote — was being read
 * for every proposal the business had ever sent so that none of it could be
 * displayed.
 *
 * scope_snapshot stays, and it is the big one. The trim panel opens over the
 * row without another round trip, and the areas it lets somebody remove come
 * from here.
 */
export type ProposalListProposal = Pick<
  JobProposal,
  | "id"
  | "job_id"
  | "token"
  | "status"
  | "total_cost"
  | "scope_snapshot"
  | "generated_at"
  | "responded_at"
  | "paid_at"
  | "client_response_note"
>;

const PROPOSAL_COLUMNS =
  "id, job_id, token, status, total_cost, scope_snapshot, generated_at, responded_at, paid_at, client_response_note";

/** Everything 0131 created. `requested_via` arrived later, in 0133, so it is
 * asked for separately — a deployment part-way between the two should lose
 * "they texted" off a history line, not the whole proposals page. */
const CORE_EDIT_COLUMNS =
  "id, proposal_id, created_at, edited_by_name, removed_zones, removed_lines, previous_total_cents, new_total_cents, note";

const EDIT_COLUMNS = `${CORE_EDIT_COLUMNS}, requested_via`;

/** How many proposals one load of the list shows. Generous on purpose: the
 * tabs above it split by status, and a page that cannot fill "Needs approval"
 * is a page that hides work from the person whose job it is to do it. */
export const PROPOSALS_PAGE_SIZE = 100;

/** The most any one caller can ask for, so "give me more" can never quietly
 * become "give me the table". */
const MAX_PROPOSALS_PAGE = 500;

/** The most trims one page will read. Twenty per proposal is far past what
 * any real proposal has been through, and it stops one pathological history
 * from turning a bounded query back into an unbounded one. */
const EDITS_PER_PROPOSAL = 20;

/** One trim the office made after the proposal went out. */
export interface ProposalEdit {
  id: string;
  createdAt: string;
  editedByName: string | null;
  removedZones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removedLines: { zoneName: string; line: string }[];
  previousTotalCents: number | null;
  newTotalCents: number | null;
  note: string | null;
  /** How the client asked for it: text, call, in_person, or office. */
  requestedVia: string | null;
}

export interface ProposalWithJob {
  proposal: ProposalListProposal;
  job: JobWithLocation;
  /** What has arrived against this job, counted once. In cents. */
  collectedCents: number;
  /** How often the client opened it, already worded. Internal only. */
  viewLabel: string;
  /** Opened repeatedly while still unanswered. Worth a phone call. */
  viewsWarm: boolean;
  /** What has been taken off since it went out, newest first. */
  edits: ProposalEdit[];
}

/**
 * A page of proposals, newest first.
 *
 * Bounded. This read every proposal the business had ever generated, and
 * every trim ever made to any of them, to render a list whose first screen
 * holds four. The limit is the caller's to raise within reason.
 */
export async function listAllProposals(
  options: { limit?: string | number | null } = {}
): Promise<ProposalWithJob[]> {
  const pageSize = boundedPageSize(options.limit, PROPOSALS_PAGE_SIZE, MAX_PROPOSALS_PAGE);
  const supabase = await createClient();
  // Views alongside rather than after: it takes no ids, so waiting for the
  // proposals to come back before asking is a round trip spent doing nothing.
  const [{ data: proposals, error }, jobs, views] = await Promise.all([
    supabase
      .from("job_proposals")
      .select(PROPOSAL_COLUMNS)
      .order("generated_at", { ascending: false })
      .limit(pageSize),
    listJobsWithLocation(),
    viewsForAllProposals().catch(() => ({}) as Record<string, ViewSummary>),
  ]);
  if (error) throw error;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const rows: { proposal: ProposalListProposal; job: JobWithLocation }[] = [];
  for (const raw of proposals ?? []) {
    const proposal = raw as unknown as ProposalListProposal;
    const job = jobById.get(proposal.job_id);
    if (job) rows.push({ proposal, job });
  }

  // Trims are asked for by id, which does mean waiting for the proposals.
  // Worth the round trip: the alternative is reading the whole history of
  // every proposal that has ever been trimmed in order to show the handful
  // belonging to the page somebody is looking at.
  const edits = await listProposalEdits(
    rows.map(({ proposal }) => proposal.id),
    pageSize * EDITS_PER_PROPOSAL
  );

  const editsByProposal = new Map<string, ProposalEdit[]>();
  for (const row of edits) {
    const list = editsByProposal.get(row.proposal_id) ?? [];
    list.push({
      id: row.id,
      createdAt: row.created_at,
      editedByName: row.edited_by_name,
      removedZones: row.removed_zones ?? [],
      removedLines: row.removed_lines ?? [],
      previousTotalCents: row.previous_total_cents,
      newTotalCents: row.new_total_cents,
      note: row.note,
      requestedVia: row.requested_via ?? null,
    });
    editsByProposal.set(row.proposal_id, list);
  }

  // What has actually come in against each of these jobs. One read per source
  // for the whole page rather than per row.
  const collected = await collectedByJob(rows.map(({ job }) => job.id));

  // Worded here so the list and the job page can never say it differently.
  const now = new Date();

  return rows.map(({ proposal, job }) => {
    const summary = views[proposal.id] ?? NO_VIEWS;
    return {
      proposal,
      job,
      collectedCents: collected.get(job.id) ?? 0,
      // Same wording as the pipeline card. The same fact reading two ways on
      // two screens is how somebody stops trusting either.
      viewLabel: activityLabel(summary, now),
      viewsWarm: isWarm(summary, proposal.status),
      edits: editsByProposal.get(proposal.id) ?? [],
    };
  });
}

/** The trims belonging to the proposals on this page, newest first.
 *
 * Tolerated rather than required: before migration 0131 this table does not
 * exist, and a missing history is not a reason for an empty proposals page. */
async function listProposalEdits(proposalIds: string[], limit: number): Promise<ProposalEditRow[]> {
  if (proposalIds.length === 0) return [];
  try {
    const supabase = await createClient();
    const read = async (columns: string) =>
      supabase
        .from("proposal_edits")
        .select(columns)
        .in("proposal_id", proposalIds)
        .order("created_at", { ascending: false })
        .limit(limit);

    let { data, error } = await read(EDIT_COLUMNS);
    // Between 0131 and 0133 the table exists without requested_via. Losing
    // "they texted" off a line is a fair price; losing the whole history of
    // what came off a quote is not.
    if (isMissingColumn(error)) ({ data, error } = await read(CORE_EDIT_COLUMNS));
    return (data ?? []) as unknown as ProposalEditRow[];
  } catch {
    return [];
  }
}

type ProposalEditRow = {
  id: string;
  proposal_id: string;
  created_at: string;
  edited_by_name: string | null;
  removed_zones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removed_lines: { zoneName: string; line: string }[];
  previous_total_cents: number | null;
  new_total_cents: number | null;
  note: string | null;
  requested_via: string | null;
};


/**
 * What has arrived against each job, in cents, counted once.
 *
 * Four routes and one trap. A card payment writes a row in `payments` and
 * marks its invoice paid, so adding both counts the same money twice and a
 * half-paid job reads as settled. Payments carry the invoice they settled, so
 * an invoice already answered for by a payment is skipped rather than added.
 *
 * The card surcharge is taken back off. A $4,520 job paid by card arrives as
 * $4,678.20, and counting the whole would read as the client overpaying.
 *
 * Every read is bounded by the job ids on the page, and each is allowed to
 * fail on its own: a missing table should cost a money line, not the list of
 * proposals.
 */
async function collectedByJob(jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobIds.length === 0) return out;

  const supabase = await createClient();
  const add = (jobId: string | null | undefined, cents: number) => {
    if (!jobId || !Number.isFinite(cents) || cents <= 0) return;
    out.set(jobId, (out.get(jobId) ?? 0) + Math.round(cents));
  };

  const safe = async <T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
    try {
      return (await query).data ?? [];
    } catch {
      return [];
    }
  };

  const [payments, ledger, invoices, plans] = await Promise.all([
    safe<{ job_id: string | null; amount_cents: number | null; surcharge_cents: number | null; invoice_id: string | null }>(
      supabase.from("payments").select("job_id, amount_cents, surcharge_cents, invoice_id").in("job_id", jobIds)
    ),
    safe<{ job_id: string | null; amount: number | null }>(
      supabase.from("ledger_entries").select("job_id, amount").eq("direction", "in").in("job_id", jobIds)
    ),
    safe<{ id: string; job_id: string | null; amount: number | null; status: string | null; paid_at: string | null }>(
      supabase.from("invoices").select("id, job_id, amount, status, paid_at").in("job_id", jobIds)
    ),
    safe<{ id: string; job_id: string | null }>(
      supabase.from("payment_plans").select("id, job_id").in("job_id", jobIds)
    ),
  ]);

  const invoicesAlreadyPaidByAPayment = new Set(
    payments.map((p) => p.invoice_id).filter((id): id is string => Boolean(id))
  );

  for (const payment of payments) {
    add(payment.job_id, (payment.amount_cents ?? 0) - (payment.surcharge_cents ?? 0));
  }
  for (const entry of ledger) {
    add(entry.job_id, Math.round((Number(entry.amount) || 0) * 100));
  }
  for (const invoice of invoices) {
    if (!invoice.paid_at && invoice.status !== "paid") continue;
    if (invoicesAlreadyPaidByAPayment.has(invoice.id)) continue;
    add(invoice.job_id, Math.round((Number(invoice.amount) || 0) * 100));
  }
  // Instalments last, and only for jobs nothing else accounted for. A plan's
  // instalment is normally settled through the payments table; this catches
  // one marked paid by hand, or one whose payment never carried a job.
  const unexplained = plans.filter((plan) => plan.job_id && !out.has(plan.job_id));
  if (unexplained.length > 0) {
    const jobByPlan = new Map(unexplained.map((plan) => [plan.id, plan.job_id!]));
    const paid = await safe<{ plan_id: string; amount_cents: number | null }>(
      supabase
        .from("payment_plan_instalments")
        .select("plan_id, amount_cents")
        .not("paid_at", "is", null)
        .in("plan_id", Array.from(jobByPlan.keys()))
    );
    for (const row of paid) add(jobByPlan.get(row.plan_id), row.amount_cents ?? 0);
  }

  return out;
}
