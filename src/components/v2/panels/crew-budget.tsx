import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { readSettings } from "@/lib/data/ops-settings";
import { loadBonusPreview, loadCrewBudgets } from "@/lib/data/ops-panels";
import { money } from "@/lib/ops/kpis";
import { AutopilotSettingsForm, ApproveBonusButton } from "@/components/v2/panels/ops-autopilot-client";
import { BudgetBar, NotReady, SectionTitle } from "@/components/v2/panels/ops-shared";

/**
 * Operations › Team: today's hours against budget, job by job, and the
 * optional weekly bonus for crews that come in under.
 */
export async function CrewBudgetPanel() {
  const organizationId = await getCurrentOrganizationId();
  const { settings, ready } = await readSettings(organizationId);
  if (!ready) return <NotReady />;
  const [jobs, bonus] = await Promise.all([loadCrewBudgets(organizationId), loadBonusPreview(organizationId)]);
  const over = jobs.filter((j) => j.meter.tone === "over");
  const accrued = bonus.settled.filter((s) => s.status === "accrued" && s.amountCents > 0);

  return (
    <section className="grid gap-6">
      <div className="grid gap-3">
        <SectionTitle sub="Jobs past their budgeted hours today, and last week's bonus to approve.">Needs you</SectionTitle>
        {over.length === 0 && accrued.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nothing over budget today.</p>
        ) : (
          <ul className="grid gap-2">
            {over.map((j) => (
              <li key={j.jobId} className="rounded-xl border border-orange-300 bg-card p-3 text-sm dark:border-orange-800">
                <span className="font-semibold">{j.name}</span>: {j.meter.line}
              </li>
            ))}
            {accrued.length > 0 && (
              <li className="grid gap-2 rounded-xl border border-orange-300 bg-card p-3 text-sm dark:border-orange-800">
                <span>
                  Bonus for the week of {bonus.lastWeek}: {accrued.length} crew member{accrued.length === 1 ? "" : "s"},{" "}
                  {money(accrued.reduce((s, a) => s + a.amountCents, 0))}.
                </span>
                <ApproveBonusButton weekStart={bonus.lastWeek} label="Approve for payroll" />
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="grid gap-3">
        <SectionTitle sub="Live from the crew's taps. Crew leads see the same bar for their own job on My day.">Today&apos;s hours against budget</SectionTitle>
        {jobs.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No work on the calendar today.</p>
        ) : (
          <div className="grid gap-4 rounded-xl border bg-card p-4">
            {jobs.map((j) => (
              <BudgetBar key={j.jobId} meter={j.meter} label={j.name} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <SectionTitle
          sub={
            bonus.enabled
              ? `${money(bonus.perMemberCents)} a week to each crew member whose finished jobs came in under their budgeted hours.`
              : "Off. Turn it on below to pay a weekly bonus when a crew member's jobs come in under budget."
          }
        >
          Crew bonus, this week so far
        </SectionTitle>
        {bonus.thisWeek.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No job has finished this week yet.</p>
        ) : (
          <ul className="grid gap-1.5">
            {bonus.thisWeek.map((p) => (
              <li key={p.profileId} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 font-semibold">{p.name}</span>
                <span className="text-muted-foreground">{p.reason}</span>
                <span className="font-mono">{p.earned ? money(p.amountCents) : "–"}</span>
              </li>
            ))}
          </ul>
        )}
        <AutopilotSettingsForm settings={settings} sections={["Crew bonus"]} />
      </div>
    </section>
  );
}
