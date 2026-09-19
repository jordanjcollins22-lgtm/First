import { createClient } from "@/lib/supabase/server";
import { isClientSide } from "@/lib/contact-types";
import type { DensityPoint } from "@/lib/area-density";

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

/** Best-effort town from a free-text address: the part before the state. */
function areaFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[parts.length - 2] || "Unknown";
  return "Unknown";
}

/**
 * Every address we hold, with what it has actually paid us.
 *
 * Collected rather than quoted, and from both halves of how this business gets
 * paid: invoices that cleared, and the cash and cheques on the ledger. A
 * ranking built on quotes would rank the places that say yes to a number, not
 * the places that pay it.
 *
 * Properties with no job carry zero, which is the point — they are the density
 * without the money, and telling those two apart is the whole exercise.
 */
export async function getDensityPoints(): Promise<DensityPoint[]> {
  const supabase = await createClient();

  const [properties, jobs, invoices, ledger] = await Promise.all([
    safe(supabase.from("properties").select("id, address, lat, lng, customer_id, customer:customers(contact_type)")),
    safe(supabase.from("jobs").select("id, property_id, status")),
    safe(supabase.from("invoices").select("job_id, amount, status, paid_at")),
    safe(supabase.from("ledger_entries").select("job_id, amount, direction").eq("direction", "in")),
  ]);

  const collectedByJob = new Map<string, number>();
  const add = (jobId: string | null, amount: number) => {
    if (!jobId) return;
    collectedByJob.set(jobId, (collectedByJob.get(jobId) ?? 0) + amount);
  };

  for (const inv of invoices as unknown as {
    job_id: string;
    amount: number;
    status: string;
    paid_at: string | null;
  }[]) {
    if (inv.paid_at || inv.status === "paid") add(inv.job_id, Number(inv.amount) || 0);
  }
  for (const row of ledger as unknown as { job_id: string | null; amount: number }[]) {
    add(row.job_id, Number(row.amount) || 0);
  }

  const collectedByProperty = new Map<string, { collected: number; jobs: number }>();
  for (const job of jobs as unknown as { id: string; property_id: string; status: string }[]) {
    const entry = collectedByProperty.get(job.property_id) ?? { collected: 0, jobs: 0 };
    entry.collected += collectedByJob.get(job.id) ?? 0;
    // Cancelled work is not work done here, however much it was going to be.
    if (job.status !== "cancelled") entry.jobs += 1;
    collectedByProperty.set(job.property_id, entry);
  }

  return (
    properties as unknown as {
      id: string;
      address: string;
      lat: number;
      lng: number;
      customer: { contact_type: string | null } | null;
    }[]
  )
    // Suppliers and subcontractors have addresses too, and a stone yard is not
    // a place to knock on doors.
    .filter((p) => isClientSide(p.customer?.contact_type))
    .map((p) => {
      const money = collectedByProperty.get(p.id) ?? { collected: 0, jobs: 0 };
      return {
        lat: p.lat,
        lng: p.lng,
        collected: money.collected,
        jobs: money.jobs,
        area: areaFromAddress(p.address),
      };
    });
}
