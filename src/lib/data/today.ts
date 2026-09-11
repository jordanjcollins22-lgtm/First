import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { isTheirs } from "@/lib/dashboard";
import {
  buildToday,
  isOnDay,
  localDayKey,
  type MoneyToday,
  type SoldToday,
  type TodayView,
} from "@/lib/today";

/**
 * What happened today, for one person.
 *
 * Read against the local calendar day rather than a UTC window, because an
 * evening signature dated to the following morning is the kind of thing that
 * makes somebody stop trusting the screen.
 *
 * Scoped to their own book the same way the rest of My Day is, so an account
 * manager sees their sales and an owner sees the lot.
 */
export async function getToday(
  options: { mine?: string | null } = {},
  now: Date = new Date()
): Promise<TodayView> {
  const dayKey = localDayKey(now);

  const all = await listJobsWithLocation().catch(() => []);
  const jobs = options.mine
    ? all.filter((job) =>
        isTheirs(
          {
            accountManagerId: job.property.customer.account_manager_id,
            assignedTo: job.assigned_to,
          },
          options.mine!
        )
      )
    : all;

  if (jobs.length === 0) {
    return buildToday({ sold: [], money: [], visits: [], onSite: [], owed: 0 });
  }

  const jobIds = jobs.map((job) => job.id);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const supabase = await createClient();

  const [proposals, invoices, ledger] = await Promise.all([
    safe(
      supabase
        .from("job_proposals")
        .select("job_id, status, total_cost, responded_at")
        .in("job_id", jobIds)
    ),
    safe(supabase.from("invoices").select("job_id, amount, paid_at, status").in("job_id", jobIds)),
    safe(
      supabase
        .from("ledger_entries")
        .select("job_id, amount, direction, occurred_on, party, note")
        .eq("direction", "in")
        .in("job_id", jobIds)
    ),
  ]);

  const sold: SoldToday[] = [];
  for (const row of proposals as {
    job_id: string;
    status: string;
    total_cost: number | null;
    responded_at: string | null;
  }[]) {
    if (row.status !== "accepted") continue;
    if (!isOnDay(row.responded_at, dayKey)) continue;
    const job = byId.get(row.job_id);
    if (!job) continue;
    sold.push({
      jobId: job.id,
      customerName: job.property.customer.name,
      address: job.property.address,
      value: row.total_cost,
      at: row.responded_at!,
    });
  }

  const money: MoneyToday[] = [];
  for (const row of invoices as {
    job_id: string;
    amount: number;
    paid_at: string | null;
    status: string;
  }[]) {
    // A paid date beats a paid status: a status says it is settled, a date
    // says when, and "today" is the whole question being asked.
    if (!isOnDay(row.paid_at, dayKey)) continue;
    const job = byId.get(row.job_id);
    money.push({
      label: job ? job.property.customer.name : "Invoice",
      amount: Number(row.amount) || 0,
      via: "Invoice",
      at: row.paid_at!,
    });
  }
  for (const row of ledger as {
    job_id: string | null;
    amount: number;
    occurred_on: string;
    party: string | null;
    note: string | null;
  }[]) {
    // Ledger entries carry a day rather than a timestamp, which is what the
    // office typed and is already the local day.
    if (row.occurred_on !== dayKey) continue;
    const job = row.job_id ? byId.get(row.job_id) : null;
    money.push({
      label: job ? job.property.customer.name : row.party || row.note || "Cash in",
      amount: Number(row.amount) || 0,
      via: "Cash or check",
      at: `${row.occurred_on}T12:00:00`,
    });
  }

  const visits = jobs
    .filter(
      (job) =>
        job.evaluation_date &&
        isOnDay(job.evaluation_date, dayKey) &&
        job.evaluation_status !== "cancelled" &&
        job.status !== "cancelled" &&
        !job.declined_at
    )
    .map((job) => ({
      jobId: job.id,
      customerName: job.property.customer.name,
      address: job.property.address,
      at: job.evaluation_date!,
      status: job.evaluation_status,
    }));

  const onSite = jobs
    .filter((job) => {
      if (job.status !== "in_progress") return false;
      const start = job.project_start_date?.slice(0, 10) ?? null;
      const end = job.project_end_date?.slice(0, 10) ?? start;
      if (!start) return true;
      return start <= dayKey && (end ?? start) >= dayKey;
    })
    .map((job) => ({
      jobId: job.id,
      customerName: job.property.customer.name,
      address: job.property.address,
    }));

  return buildToday({ sold, money, visits, onSite, owed: 0 });
}

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}
