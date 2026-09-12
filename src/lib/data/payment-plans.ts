import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { Interval, PlanKind } from "@/lib/payment-plan";

export interface PlanInstalment {
  id: string;
  number: number;
  amountCents: number;
  dueOn: string;
  isDeposit: boolean;
  status: "due" | "paid" | "failed" | "cancelled";
  paidAt: string | null;
  hostedUrl: string | null;
}

export interface Plan {
  id: string;
  customerId?: string;
  customerName?: string | null;
  kind: PlanKind;
  totalCents: number;
  depositCents: number;
  instalments: number | null;
  interval: Interval | null;
  jobId?: string | null;
  status: "offered" | "accepted" | "active" | "settled" | "cancelled";
  acceptedAt: string | null;
  schedule: PlanInstalment[];
  paidCents: number;
}

const PLAN_COLUMNS =
  "id, kind, total_cents, deposit_cents, instalments, interval, status, accepted_at, customer_id, job_id, payment_plan_instalments(id, number, amount_cents, due_on, is_deposit, status, paid_at, hosted_url)";

/** The plans on a job, newest first, with their schedules and what has landed. */
export async function listPlansForJob(jobId: string): Promise<Plan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payment_plans")
    .select(PLAN_COLUMNS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (isMissingTable(error) || error || !data) return [];

  const ids = (data as { id: string }[]).map((row) => row.id);
  const { data: paidRows } = await supabase
    .from("payments")
    .select("plan_id, amount_cents")
    .in("plan_id", ids.length > 0 ? ids : ["none"]);

  const paidByPlan = new Map<string, number>();
  for (const row of (paidRows ?? []) as { plan_id: string | null; amount_cents: number }[]) {
    if (!row.plan_id) continue;
    paidByPlan.set(row.plan_id, (paidByPlan.get(row.plan_id) ?? 0) + Number(row.amount_cents));
  }

  return shapePlans(data, paidByPlan);
}

/** The plans across the whole book, newest first. Bounded: a schedule list
 * nobody can reach the bottom of is not a list anybody works from. */
export async function listPlans(limit = 50): Promise<Plan[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data, error } = await supabase
    .from("payment_plans")
    .select(`${PLAN_COLUMNS}, customers(name)`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (isMissingTable(error) || error || !data) return [];

  const ids = (data as { id: string }[]).map((row) => row.id);
  const { data: paidRows } = await supabase
    .from("payments")
    .select("plan_id, amount_cents")
    .in("plan_id", ids.length > 0 ? ids : ["none"]);

  const paidByPlan = new Map<string, number>();
  for (const row of (paidRows ?? []) as { plan_id: string | null; amount_cents: number }[]) {
    if (!row.plan_id) continue;
    paidByPlan.set(row.plan_id, (paidByPlan.get(row.plan_id) ?? 0) + Number(row.amount_cents));
  }

  return shapePlans(data, paidByPlan);
}

function shapePlans(data: unknown, paidByPlan: Map<string, number>): Plan[] {
  return (data as unknown as {
    id: string;
    kind: string;
    total_cents: number;
    deposit_cents: number;
    instalments: number | null;
    interval: string | null;
    status: string;
    accepted_at: string | null;
    customer_id: string;
    job_id: string | null;
    customers?: { name: string } | null;
    payment_plan_instalments: {
      id: string;
      number: number;
      amount_cents: number;
      due_on: string;
      is_deposit: boolean;
      status: string;
      paid_at: string | null;
      hosted_url: string | null;
    }[];
  }[]).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customers?.name ?? null,
    jobId: row.job_id,
    kind: row.kind as PlanKind,
    totalCents: Number(row.total_cents),
    depositCents: Number(row.deposit_cents),
    instalments: row.instalments,
    interval: (row.interval as Interval | null) ?? null,
    status: row.status as Plan["status"],
    acceptedAt: row.accepted_at,
    paidCents: paidByPlan.get(row.id) ?? 0,
    schedule: [...(row.payment_plan_instalments ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((item) => ({
        id: item.id,
        number: item.number,
        amountCents: Number(item.amount_cents),
        dueOn: item.due_on,
        isDeposit: item.is_deposit,
        status: item.status as PlanInstalment["status"],
        paidAt: item.paid_at,
        hostedUrl: item.hosted_url,
      })),
  }));
}
