import { isTestLead } from "@/lib/am-home";
import { groupVisits, visitStage, type VisitStage } from "@/lib/evaluation-visit";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import type { Profile } from "@/types/domain";

/** One paid visit, as the account manager's Evaluations screen draws it. */
export interface EvalVisit {
  id: string;
  evaluationDate: string;
  evaluationStatus: string;
  jobStatus: string;
  stage: VisitStage;
  name: string;
  what: string;
  address: string | null;
  phone: string | null;
  doNotContact: boolean;
}

const DAY = 86_400_000;

/**
 * The account manager's visits in three piles: today, the next three weeks,
 * and the ones already visited that still need pricing. Their own clients,
 * or everyone's when a client has no account manager set.
 */
export async function loadAmEvaluations(profile: Profile, now: Date = new Date()) {
  const sb = await createClient();
  const from = new Date(now.getTime() - 45 * DAY).toISOString();
  const to = new Date(now.getTime() + 22 * DAY).toISOString();
  const { data } = await sb
    .from("jobs")
    .select(
      "id,name,status,evaluation_date,evaluation_status,evaluator_on_way_at,evaluator_arrived_at,cancelled_at,property:properties!inner(address,customer:customers!inner(name,phone,email,do_not_contact,account_manager_id,organization_id))"
    )
    .eq("property.customer.organization_id", profile.organization_id)
    .gte("evaluation_date", from)
    .lte("evaluation_date", to)
    .is("cancelled_at", null)
    .order("evaluation_date", { ascending: true })
    .limit(300);
  type R = {
    id: string;
    name: string | null;
    status: string;
    evaluation_date: string;
    evaluation_status: string | null;
    evaluator_on_way_at: string | null;
    evaluator_arrived_at: string | null;
    property: { address: string | null; customer: { name: string | null; phone: string | null; email?: string | null; do_not_contact: boolean | null; account_manager_id: string | null } | null } | null;
  };
  const rows: EvalVisit[] = ((data ?? []) as unknown as R[])
    .filter((j) => {
      const am = j.property?.customer?.account_manager_id;
      if (isTestLead({ customerName: j.property?.customer?.name ?? "", email: j.property?.customer?.email, jobName: j.name })) return false;
      return !am || am === profile.id;
    })
    .map((j) => ({
      id: j.id,
      evaluationDate: j.evaluation_date,
      evaluationStatus: j.evaluation_status ?? "scheduled",
      jobStatus: j.status,
      stage: visitStage({ evaluation_status: j.evaluation_status ?? "scheduled", evaluator_on_way_at: j.evaluator_on_way_at, evaluator_arrived_at: j.evaluator_arrived_at }),
      name: j.property?.customer?.name || "Client",
      what: j.name || "Visit",
      address: j.property?.address ?? null,
      phone: j.property?.customer?.phone ?? null,
      doNotContact: !!j.property?.customer?.do_not_contact,
    }));
  return groupVisits(rows, now, BUSINESS_TIME_ZONE);
}
