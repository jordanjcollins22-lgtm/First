import { createClient } from "@/lib/supabase/server";
import { salesStage, type SalesStage } from "@/lib/sales-progress";

/**
 * Sales in progress, for the owner and the account managers: every proposal
 * between the walkthrough and the client's answer, plus the answers from the
 * last week, each with where it has got to. Read from what is already
 * recorded: the proposal, the client's opens and their messages.
 */

export interface SaleInProgress {
  jobId: string;
  client: string;
  address: string;
  totalCents: number | null;
  sentAt: string | null;
  stage: SalesStage;
  /** Where the account manager acts on it: the price card, or the client's conversation. */
  actionHref: string;
}

/** Answers older than this drop off the list; the job is in Operations or closed by then. */
const DECIDED_SHOWN_FOR_DAYS = 7;

type Row = {
  id: string;
  job_id: string;
  status: string;
  total_cost: number | string | null;
  discount_amount: number | string | null;
  approved_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  jobs: {
    status: string;
    evaluation_submitted_at: string | null;
    properties: { address: string | null; customers: { name: string | null; account_manager_id: string | null } | null } | null;
  } | null;
};

export async function getSalesInProgress(viewer: { id: string; seesAll: boolean }, now: Date = new Date()): Promise<SaleInProgress[]> {
  const supabase = await createClient();
  const since = new Date(now.getTime() - DECIDED_SHOWN_FOR_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("job_proposals")
    .select(
      "id, job_id, status, total_cost, discount_amount, approved_at, sent_at, responded_at, expires_at, jobs!inner(status, evaluation_submitted_at, properties(address, customers(name, account_manager_id)))"
    )
    .or(`status.in.(draft,needs_approval,sent),responded_at.gte.${since}`);

  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.jobs && r.jobs.status !== "cancelled" && (viewer.seesAll || r.jobs.properties?.customers?.account_manager_id === viewer.id)
  );
  if (rows.length === 0) return [];

  const [{ data: views }, { data: messages }] = await Promise.all([
    supabase.from("proposal_views").select("proposal_id, viewed_at").in("proposal_id", rows.map((r) => r.id)).order("viewed_at"),
    supabase
      .from("job_messages")
      .select("job_id, author_type, created_at")
      .eq("channel", "external")
      .in("job_id", rows.map((r) => r.job_id))
      .order("created_at", { ascending: false }),
  ]);

  const viewsFor = new Map<string, string[]>();
  for (const v of (views ?? []) as { proposal_id: string; viewed_at: string }[]) {
    viewsFor.set(v.proposal_id, [...(viewsFor.get(v.proposal_id) ?? []), v.viewed_at]);
  }
  // The newest message on each job's client thread: a question is waiting when the client wrote last.
  const lastMessage = new Map<string, { author_type: string; created_at: string }>();
  for (const m of (messages ?? []) as { job_id: string; author_type: string; created_at: string }[]) {
    if (!lastMessage.has(m.job_id)) lastMessage.set(m.job_id, m);
  }

  const sales = rows.map((r) => {
    const last = lastMessage.get(r.job_id);
    const asked = last && last.author_type === "client" && r.sent_at && last.created_at > r.sent_at ? last.created_at : null;
    const stage = salesStage(
      {
        walkthroughAt: r.jobs?.evaluation_submitted_at ?? null,
        proposalStatus: r.status,
        approvedAt: r.approved_at,
        sentAt: r.sent_at,
        views: viewsFor.get(r.id) ?? [],
        respondedAt: r.responded_at,
        expiresAt: r.expires_at,
        unansweredQuestionAt: asked,
      },
      now
    );
    const total = r.total_cost == null ? null : Number(r.total_cost) - Number(r.discount_amount ?? 0);
    return {
      jobId: r.job_id,
      client: r.jobs?.properties?.customers?.name ?? "Client",
      address: r.jobs?.properties?.address ?? "",
      totalCents: total == null ? null : Math.round(total * 100),
      sentAt: r.sent_at,
      stage,
      actionHref: asked ? `/conversations/job/${r.job_id}` : stage.step <= 2 && !stage.outcome ? `/sales?tab=today&price=${r.job_id}#price-${r.job_id}` : `/jobs/${r.job_id}`,
    };
  });

  // Urgent first, then anything with something to do, then by how far along; answers last.
  const rank = (s: SaleInProgress) => (s.stage.outcome ? 3 : s.stage.urgent ? 0 : s.stage.issues.length > 0 ? 1 : 2);
  return sales.sort((a, b) => rank(a) - rank(b) || b.stage.step - a.stage.step || (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
}
