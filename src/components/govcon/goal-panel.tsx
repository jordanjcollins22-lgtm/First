import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { GoalStatus } from "@/lib/govcon/goal-status";

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}k` : `$${Math.round(n)}`;

/** Revenue goal vs. reality, and what volume it takes to close the gap. */
export function GoalPanel({ goal }: { goal: GoalStatus }) {
  const pct = Math.min(100, (goal.runRate / Math.max(1, goal.target)) * 100);
  const outgrow = goal.sizeRunway
    .filter((r) => r.yearsUntilOtherThanSmall !== null && r.yearsUntilOtherThanSmall <= 5)
    .sort((a, b) => (a.yearsUntilOtherThanSmall ?? 99) - (b.yearsUntilOtherThanSmall ?? 99));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue goal: {money(goal.target)}/month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span>
              Run-rate from {goal.activeContracts} active contract{goal.activeContracts === 1 ? "" : "s"}: <strong>{money(goal.runRate)}/mo</strong>
            </span>
            <span className="tabular-nums">{pct.toFixed(1)}%</span>
          </div>
          <Progress value={pct} />
        </div>

        <p>
          At an average contract of <strong>{money(goal.avgAnnualValue)}/yr</strong> ({goal.avgAnnualValueSource}) and a{" "}
          {(goal.winRate * 100).toFixed(1)}% win rate ({goal.winRateObserved ? "observed" : "industry default until 10 decisions"}), the goal
          takes <strong>{goal.plan.activeContractsNeeded.toLocaleString()} active contracts</strong>:{" "}
          <strong>{goal.plan.winsPerMonth} wins</strong> and <strong>{goal.plan.proposalsPerMonth.toLocaleString()} proposals a month</strong>,
          sustained for about {goal.plan.monthsToTarget} months. This month: {goal.proposalsThisMonth} submitted. The pipeline is set to read up to{" "}
          {goal.effectiveAnalysesPerDay} solicitations a day.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">If we mostly win…</th>
                <th className="pr-2">Active contracts</th>
                <th className="pr-2">Wins / mo</th>
                <th className="pr-2">Proposals / mo</th>
              </tr>
            </thead>
            <tbody>
              {goal.tiers.map((t) => (
                <tr key={t.key} className="border-t border-border align-top">
                  <td className="py-2 pr-2">
                    {t.label}
                    <div className="text-xs text-muted-foreground">{t.note}</div>
                  </td>
                  <td className="pr-2 tabular-nums">{t.plan.activeContractsNeeded.toLocaleString()}</td>
                  <td className="pr-2 tabular-nums">{t.plan.winsPerMonth}</td>
                  <td className="pr-2 tabular-nums">{t.plan.proposalsPerMonth.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!!outgrow.length && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="font-medium">At {money(goal.target * 12)}/yr you outgrow small-business status (5-year average receipts):</p>
            <ul className="mt-1 list-disc pl-5">
              {outgrow.map((r) => (
                <li key={r.naics}>
                  {r.label} ({r.naics}, {money(r.receipts)} standard): ~{r.yearsUntilOtherThanSmall} yr
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">After that, small-business set-asides in those codes close to you. Plan to win unrestricted and facilities-support work by then.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
