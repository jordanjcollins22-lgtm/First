import { createClient } from "@/lib/supabase/server";

type Zone = { serviceLabel?: string | null; scopeText?: string | null };

/**
 * What we're doing there, in plain words: the job's own name when it says
 * that, otherwise the services on the proposal ("Trimming, Mulch"), otherwise
 * the first line of its scope. Never "Estimate" or a bare address.
 */
export function workLine(jobName: string | null, zones: unknown): string {
  const name = (jobName ?? "").trim();
  // Older names start with the address ("217 Ewing Street, Bel Air, Add-on: ..."): keep only the last part.
  const parts = /^\d/.test(name) ? name.split(/,|—/).map((p) => p.trim()).filter(Boolean) : [name];
  const named = parts[parts.length - 1] ?? "";
  if (named && !/^(estimate|evaluation|landscape reset|project)$/i.test(named) && !/(United States|\b\d{5}$)/.test(named)) return named;
  const list = Array.isArray(zones) ? (zones as Zone[]) : [];
  const labels = [...new Set(list.map((z) => (z.serviceLabel ?? "").trim()).filter(Boolean))];
  if (labels.length) return labels.join(", ");
  const text = list.map((z) => z.scopeText ?? "").find((t) => t.trim());
  if (text) {
    const first = text.replace(/^[\s*•-]+/, "").split(/\n|(?<=\.)\s/)[0].trim();
    return first.length > 90 ? `${first.slice(0, 87)}...` : first;
  }
  return named || "Project";
}

/** A sold project: the client said yes to its proposal. */
export interface ClosedProject {
  jobId: string;
  customerName: string;
  work: string;
  total: number;
  paid: number;
  closedOn: string | null;
  status: string;
}

/**
 * Projects sold in the last `days` days, newest first: every accepted
 * proposal, with what's been paid so far. Scoped by row-level security.
 */
export async function loadClosedProjects(days = 90, now: Date = new Date()): Promise<ClosedProject[]> {
  const sb = await createClient();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { data } = await sb
    .from("job_proposals")
    .select("job_id, total_cost, responded_at, approved_at, paid_at, updated_at, scope_snapshot, jobs!inner(name, status, declined_at, is_test, properties(customers(name)))")
    .eq("status", "accepted")
    .or(`responded_at.gte.${since},and(responded_at.is.null,updated_at.gte.${since})`)
    .order("updated_at", { ascending: false })
    .limit(200);
  type R = {
    job_id: string;
    total_cost: number | null;
    responded_at: string | null;
    approved_at: string | null;
    paid_at: string | null;
    updated_at: string;
    scope_snapshot: unknown;
    jobs: { name: string | null; status: string; declined_at: string | null; is_test: boolean | null; properties: { customers: { name: string | null } | null } | null } | null;
  };
  const rows = ((data ?? []) as unknown as R[]).filter((r) => r.jobs && r.jobs.status !== "cancelled" && !r.jobs.is_test);
  // One line per job: the newest accepted proposal wins.
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.job_id) ? false : (seen.add(r.job_id), true)));
  const ids = unique.map((r) => r.job_id);
  const { data: pays } = ids.length ? await sb.from("payments").select("job_id, amount_cents").in("job_id", ids) : { data: [] };
  const paid = new Map<string, number>();
  for (const p of (pays ?? []) as { job_id: string; amount_cents: number }[]) paid.set(p.job_id, (paid.get(p.job_id) ?? 0) + p.amount_cents / 100);
  return unique
    .map((r) => {
      const closed = r.responded_at ?? r.paid_at ?? r.approved_at ?? r.updated_at;
      return {
        jobId: r.job_id,
        customerName: r.jobs?.properties?.customers?.name || "Client",
        work: workLine(r.jobs?.name ?? null, r.scope_snapshot),
        total: Number(r.total_cost ?? 0),
        paid: paid.get(r.job_id) ?? 0,
        closedOn: closed ? closed.slice(0, 10) : null,
        status: r.jobs!.status,
      };
    })
    .sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? ""));
}
