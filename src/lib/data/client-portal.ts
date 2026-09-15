import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { orderProjects, type ClientProject, type ProjectStage } from "@/lib/client-portal";

/**
 * One client's own work, read as themselves.
 *
 * Every read here starts from the signed-in auth user and walks to the single
 * customer row that claims it. Nothing takes a customer id from a request, so
 * there is no id to tamper with: a client who edits a URL is still the same
 * auth user and still reaches the same one record.
 *
 * The admin client is used deliberately. A client has no profile and no role,
 * so the ordinary policies — which are all written in terms of the staff
 * organization — would return nothing at all. The scoping is done here, in one
 * function, rather than by a policy that would have to understand two kinds of
 * reader.
 */

export interface ClientIdentity {
  authUserId: string;
  customerId: string;
  name: string;
  email: string | null;
}

/** Who is signed in, if it is a client rather than a member of staff. */
export async function currentClient(): Promise<ClientIdentity | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();

  // Staff first. Somebody with a profile is a member of staff and has the
  // whole app; sending them to a client page would be confusing rather than
  // dangerous, but it is still the wrong screen.
  const { data: profile } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (profile) return null;

  const { data: customer } = await admin
    .from("customers")
    .select("id, name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!customer) return null;

  return {
    authUserId: user.id,
    customerId: customer.id,
    name: customer.name ?? "there",
    email: customer.email ?? user.email ?? null,
  };
}

/**
 * Everything this client has with us.
 *
 * Their projects, their quotes and what is left to pay, and nothing about
 * anybody else. Money is summed from what is attached to their own jobs.
 */
export async function projectsForClient(customerId: string): Promise<ClientProject[]> {
  const admin = createAdminClient();

  const { data: properties } = await admin
    .from("properties")
    .select("id, address")
    .eq("customer_id", customerId);

  const propertyIds = (properties ?? []).map((p) => p.id);
  if (propertyIds.length === 0) return [];
  const addressOf = new Map((properties ?? []).map((p) => [p.id, p.address ?? ""]));

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, property_id, status, evaluation_date, evaluation_status, evaluation_mode, updated_at, created_at")
    .in("property_id", propertyIds);

  const rows = jobs ?? [];
  if (rows.length === 0) return [];
  const jobIds = rows.map((job) => job.id);

  const [{ data: proposals }, { data: payments }, { data: observers }] = await Promise.all([
    admin
      .from("job_proposals")
      .select("job_id, token, status, total_cost, paid_at")
      .in("job_id", jobIds),
    admin.from("payments").select("job_id, amount_cents, surcharge_cents").in("job_id", jobIds),
    admin.from("job_observers").select("job_id, token, revoked_at").in("job_id", jobIds),
  ]);

  const proposalOf = new Map((proposals ?? []).map((p) => [p.job_id, p]));
  const paidOf = new Map<string, number>();
  for (const payment of payments ?? []) {
    if (!payment.job_id) continue;
    const cents = (payment.amount_cents ?? 0) - (payment.surcharge_cents ?? 0);
    paidOf.set(payment.job_id, (paidOf.get(payment.job_id) ?? 0) + cents);
  }
  const progressOf = new Map(
    (observers ?? []).filter((o) => !o.revoked_at).map((o) => [o.job_id, o.token])
  );

  return orderProjects(
    rows.map((job) => {
      const proposal = proposalOf.get(job.id) ?? null;
      const totalCents = proposal?.total_cost == null ? 0 : Math.round(Number(proposal.total_cost) * 100);
      const collected = paidOf.get(job.id) ?? 0;
      const settled = Boolean(proposal?.paid_at);

      return {
        jobId: job.id,
        address: addressOf.get(job.property_id ?? "") ?? "Your property",
        stage: stageOf(job, proposal?.status ?? null),
        evaluationAt: job.evaluation_date ?? null,
        digital: job.evaluation_mode === "digital",
        // Only ever a quote they are meant to see. A draft the office is still
        // writing is not one of them.
        proposalToken: proposal && proposal.status !== "needs_approval" ? proposal.token : null,
        proposalStatus: proposal?.status ?? null,
        totalCost: proposal?.total_cost == null ? null : Number(proposal.total_cost),
        outstandingCents: settled ? 0 : Math.max(0, totalCents - collected),
        progressToken: progressOf.get(job.id) ?? null,
        updatedAt: job.updated_at ?? job.created_at ?? new Date().toISOString(),
      };
    })
  );
}

/** Where a job has got to, in the client's terms rather than ours. */
function stageOf(
  job: { status: string | null; evaluation_status: string | null },
  proposalStatus: string | null
): ProjectStage {
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "completed") return "finished";
  if (job.status === "in_progress") return "in_progress";
  if (job.status === "approved" || proposalStatus === "accepted") {
    return job.status === "approved" ? "scheduled" : "accepted";
  }
  if (proposalStatus === "sent" || proposalStatus === "declined") return "quoted";
  return "evaluation_booked";
}
