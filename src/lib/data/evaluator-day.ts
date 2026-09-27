import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { groupVisits, visitStage, type VisitStage } from "@/lib/evaluation-visit";

export interface Visit {
  id: string;
  evaluationDate: string;
  evaluationStatus: string;
  jobStatus: string;
  stage: VisitStage;
  clientName: string;
  phone: string | null;
  address: string;
  /** Whether the client has sent the pre-evaluation form. */
  formSent: boolean;
  /** Who it is booked with, when showing everybody's. */
  evaluatorName: string | null;
}

export interface EvaluatorDay {
  today: Visit[];
  upcoming: Visit[];
  toWriteUp: Visit[];
  timeZone: string;
  /** Showing the whole team's visits rather than the viewer's own. */
  everyone: boolean;
  canSeeEveryone: boolean;
}

/**
 * The evaluator's visits: their own, or everyone's for somebody who runs
 * the business and asks for it.
 */
export async function getEvaluatorDay(options: { everyone?: boolean } = {}): Promise<EvaluatorDay | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const canSeeEveryone = profile.roles.some((r) => ["admin", "owner"].includes(r.toLowerCase()));
  const everyone = Boolean(options.everyone && canSeeEveryone);
  const organization = await getCurrentOrganization().catch(() => null);
  const timeZone = organization?.reminder_time_zone || "America/New_York";

  const supabase = await createClient();
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  let query = supabase
    .from("jobs")
    .select(
      "id, status, evaluation_date, evaluation_status, evaluator_on_way_at, evaluator_arrived_at, assigned_to, property:properties(address, customer:customers(name, phone)), assignee:profiles!jobs_assigned_to_fkey(full_name, email), intake:evaluation_intakes(submitted_at)"
    )
    .not("evaluation_date", "is", null)
    .gte("evaluation_date", since)
    .order("evaluation_date", { ascending: true })
    .limit(300);
  if (!everyone) query = query.eq("assigned_to", profile.id);
  const { data, error } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    status: string;
    evaluation_date: string;
    evaluation_status: string;
    evaluator_on_way_at: string | null;
    evaluator_arrived_at: string | null;
    property: { address: string | null; customer: { name: string | null; phone: string | null } | null } | null;
    assignee: { full_name: string | null; email: string | null } | null;
    intake: { submitted_at: string | null }[] | { submitted_at: string | null } | null;
  };
  const visits: Visit[] = ((data ?? []) as unknown as Row[]).map((row) => {
    const intakes = Array.isArray(row.intake) ? row.intake : row.intake ? [row.intake] : [];
    return {
      id: row.id,
      evaluationDate: row.evaluation_date,
      evaluationStatus: row.evaluation_status,
      jobStatus: row.status,
      stage: visitStage(row),
      clientName: row.property?.customer?.name || "Client",
      phone: row.property?.customer?.phone ?? null,
      address: row.property?.address ?? "",
      formSent: intakes.some((i) => Boolean(i.submitted_at)),
      evaluatorName: everyone ? row.assignee?.full_name || row.assignee?.email || null : null,
    };
  });

  return { ...groupVisits(visits, new Date(), timeZone), timeZone, everyone, canSeeEveryone };
}
