import { loadCrewBudgets } from "@/lib/data/ops-panels";
import { BudgetBar } from "@/components/v2/panels/ops-shared";

/**
 * For My day: the crew lead's job today, hours budgeted against hours used so
 * far. Hours only; what the job pays or costs is not on a crew phone.
 *
 * Renders nothing for somebody who leads no job today, so it can be mounted
 * for everybody without a role check around it. The page's existing
 * AutoRefresh keeps it live.
 */
export async function CrewBudgetRemaining({ profileId, organizationId }: { profileId: string; organizationId: string }) {
  const jobs = await loadCrewBudgets(organizationId, { leadId: profileId }).catch(() => []);
  if (jobs.length === 0) return null;
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-label="Hours left on today's job">
      <h2 className="font-bold">Hours left today</h2>
      {jobs.map((j) => (
        <BudgetBar key={j.jobId} meter={j.meter} label={j.name} />
      ))}
    </section>
  );
}
