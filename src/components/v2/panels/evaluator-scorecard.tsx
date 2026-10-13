import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadOpenSalesExceptions, loadScorecard } from "@/lib/data/sales-panels";
import { CLOSE_RATE_BAND, type ScorecardRow, type Tone } from "@/lib/sales/scorecard";
import { formatHours } from "@/lib/sales/speed-to-proposal";
import { KpiTile, NeedsYouStrip, PanelSection, TONE_CLASS, pct, usd } from "@/components/v2/panels/sales/sales-ui";
import { ExceptionButtons } from "@/components/v2/panels/sales/pipeline-autopilot-controls";
import { OpenEntityName } from "@/components/v2/panels/sales/open-entity-button";

/**
 * Sales › Evaluations: one row per evaluator, judged on close rate.
 *
 * Close rate is the target. The planning band is 45-55% of decided
 * proposals; the business is at 45% today, so the aim is the top of it.
 * Around it, the numbers that explain a close rate: visits and whether the
 * client was home, proposals out and how fast, the size of the ticket, the
 * money sold and the commission it earned.
 */
export async function EvaluatorScorecardPanel() {
  const organizationId = await getCurrentOrganizationId();
  const [data, overdue] = await Promise.all([loadScorecard(organizationId), loadOpenSalesExceptions(organizationId, ["proposal_overdue"])]);
  const team = data.team;

  return (
    <div className="grid gap-6">
      <PanelSection title="Needs you" sub="Proposals past the speed target, with the evaluator they went to.">
        <NeedsYouStrip
          empty="No evaluation is waiting on its proposal."
          items={overdue.map((item) => ({
            id: item.id,
            summary: item.summary,
            who: item.assignee,
            open: item.jobId ? { kind: "sales.job", id: item.jobId } : null,
            actions: item.kind === "backlog" ? null : <ExceptionButtons id={item.id} jobId={item.jobId} kind={item.kind} />,
          }))}
        />
      </PanelSection>

      <PanelSection
        title="The team against target"
        sub={`The last ${data.windowDays} days. Close rate target ${pct(CLOSE_RATE_BAND.high)} (band ${pct(CLOSE_RATE_BAND.low)}–${pct(CLOSE_RATE_BAND.high)}, Level CFO, labelled unverified; now ${pct(CLOSE_RATE_BAND.now)}).`}
      >
        {team ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiTile label="Close rate" value={pct(team.closeRate)} target={`${pct(CLOSE_RATE_BAND.high)}`} tone={team.closeTone} note={`${team.accepted} won, ${team.declined} lost.`} />
            <KpiTile label="Show rate" value={pct(team.showRate)} target="≥ 90%" tone={tone(team.showRate, 0.9, 0.8)} note={`${team.shows} of ${team.visits} visits happened.`} />
            <KpiTile label="Revenue sold" value={usd(team.revenueSold)} target="no band" tone="neutral" note={`Average ticket ${usd(team.averageTicket)}.`} />
            <KpiTile label="Commission earned" value={usd(team.commissionEarned)} target="no band" tone="neutral" note={`The evaluator's ${data.commissionPct}% of what has been collected on what they sold.`} />
          </div>
        ) : (
          <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">No evaluations in the last {data.windowDays} days.</p>
        )}
      </PanelSection>

      <PanelSection title="Evaluator scorecard" sub="Sorted by money sold. A close rate on fewer than three decided proposals isn't coloured: it says more about luck than the person.">
        {data.rows.length === 0 ? (
          <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Nobody has done an evaluation in the window yet.</p>
        ) : (
          <ul className="grid gap-3">
            {data.rows.map((row) => (
              <EvaluatorCard key={row.evaluatorId} row={row} speedTargetHours={data.speedTargetHours} />
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}

function tone(value: number | null, good: number, bad: number): Tone {
  if (value == null) return "neutral";
  return value >= good ? "good" : value >= bad ? "warn" : "bad";
}

function EvaluatorCard({ row, speedTargetHours }: { row: ScorecardRow; speedTargetHours: number }) {
  const cells: { label: string; value: string; tone?: Tone }[] = [
    { label: "Visits", value: String(row.visits) },
    { label: "Show rate", value: pct(row.showRate), tone: row.visits >= 3 ? tone(row.showRate, 0.9, 0.8) : "neutral" },
    { label: "Proposals sent", value: String(row.proposalsSent) },
    {
      label: "Speed to proposal",
      value: formatHours(row.medianHoursToProposal),
      tone: row.withinSpeedTarget == null ? "neutral" : tone(row.withinSpeedTarget, 0.9, 0.6),
    },
    { label: "Average ticket", value: usd(row.averageTicket) },
    { label: "Revenue sold", value: usd(row.revenueSold) },
    { label: "Commission earned", value: usd(row.commissionEarned) },
  ];
  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <OpenEntityName entity={{ kind: "sales.evaluator", id: row.evaluatorId }} name={row.name} className="text-base font-bold" />
        <p className={`rounded-full border px-3 py-1 text-sm font-semibold ${TONE_CLASS[row.closeTone]}`}>
          Close rate {pct(row.closeRate)} <span className="font-normal">({row.accepted} of {row.accepted + row.declined})</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((c) => (
          <div key={c.label} className={`rounded-lg border p-2 ${TONE_CLASS[c.tone ?? "neutral"]}`}>
            <dt className="text-[11px] uppercase tracking-wide opacity-75">{c.label}</dt>
            <dd className="font-mono text-lg">{c.value}</dd>
          </div>
        ))}
      </dl>
      {row.withinSpeedTarget != null && (
        <p className="text-xs text-muted-foreground">
          {pct(row.withinSpeedTarget)} of their proposals went out within {speedTargetHours} hours of the visit.
        </p>
      )}
    </li>
  );
}
