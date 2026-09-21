import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { addressKey, findDuplicates } from "@/lib/duplicate-jobs";

export interface DuplicateStanding {
  /** This job copies that one. */
  copyOf: { jobId: string; label: string } | null;
  /** This job is the one kept; these copy it. */
  copies: { jobId: string; label: string }[];
}

/**
 * Where one job stands among the live jobs at its address for its person.
 *
 * Reads only jobs whose address starts the same way, so a job page costs
 * one narrow query rather than the whole book.
 */
export async function duplicateStanding(jobId: string): Promise<DuplicateStanding> {
  const none: DuplicateStanding = { copyOf: null, copies: [] };
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  const { data: me } = await supabase.from("jobs").select("id, property:properties!inner(address)").eq("id", jobId).maybeSingle();
  const mine = (me as unknown as { property: { address: string } } | null)?.property.address;
  if (!mine) return none;
  const firstLine = mine.split(",")[0].trim();
  if (!firstLine) return none;

  type Row = {
    id: string;
    status: string;
    evaluation_status: string;
    created_at: string;
    property: { address: string; customer: { name: string; organization_id: string } };
  };
  const { data: rows } = await supabase
    .from("jobs")
    .select("id, status, evaluation_status, created_at, property:properties!inner(address, customer:customers!inner(name, organization_id))")
    .eq("property.customer.organization_id", org)
    .neq("status", "cancelled")
    .ilike("property.address", `${firstLine.split(" ")[0]}%`)
    .limit(200);
  const jobs = ((rows ?? []) as unknown as Row[]).filter((r) => addressKey(r.property.address) === addressKey(mine));
  if (jobs.length < 2) return none;

  const { data: proposals } = await supabase
    .from("job_proposals")
    .select("job_id, status, generated_at")
    .in("job_id", jobs.map((j) => j.id))
    .order("generated_at", { ascending: false });
  const proposalByJob = new Map<string, string>();
  for (const p of (proposals ?? []) as { job_id: string; status: string }[]) if (!proposalByJob.has(p.job_id)) proposalByJob.set(p.job_id, p.status);

  const found = findDuplicates(
    jobs.map((j) => ({
      id: j.id,
      address: j.property.address,
      customerName: j.property.customer.name,
      createdAt: j.created_at,
      status: j.status,
      evaluationStatus: j.evaluation_status,
      proposalStatus: proposalByJob.get(j.id) ?? null,
    }))
  );
  const labelOf = new Map(jobs.map((j) => [j.id, j.property.customer.name]));
  const copyOf = found.get(jobId);
  return {
    copyOf: copyOf ? { jobId: copyOf.keeperId, label: copyOf.keeperLabel } : null,
    copies: [...found.entries()].filter(([, d]) => d.keeperId === jobId).map(([id]) => ({ jobId: id, label: labelOf.get(id) ?? "the copy" })),
  };
}
