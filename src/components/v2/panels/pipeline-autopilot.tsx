import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadPipelineAutopilot, WINDOW_DAYS } from "@/lib/data/sales-panels";
import { KPI_BANDS, toneFor } from "@/lib/sales/sales-kpis";
import { formatHours, SPEED_CLAIM } from "@/lib/sales/speed-to-proposal";
import type { Tone } from "@/lib/sales/scorecard";
import { DIVISION_LABEL, DIVISIONS } from "@/lib/sales/divisions";
import { KpiTile, NeedsYouStrip, PanelSection, pct, usd } from "@/components/v2/panels/sales/sales-ui";
import { AutopilotSettingsForm, ExceptionButtons, RateCoverage } from "@/components/v2/panels/sales/pipeline-autopilot-controls";

/**
 * Sales › Pipeline: the pipeline autopilot.
 *
 * Top, what needs a person: prices the guardrails held (with the reason),
 * proposals past the speed target, and anything from before the autopilot
 * went live. Middle, the sales numbers against the report's planning
 * bands. Bottom, the autopilot's switches and guardrails, and the rate
 * card's gaps, because a service with no rate is the commonest reason a
 * price is held.
 */
export async function PipelineAutopilotPanel() {
  const organizationId = await getCurrentOrganizationId();
  const data = await loadPipelineAutopilot(organizationId);
  const { kpis, speed, settings, activity, coverage } = data;
  const speedTone: Tone = speed.withinTarget == null ? "neutral" : speed.withinTarget >= 0.9 ? "good" : speed.withinTarget >= 0.6 ? "warn" : "bad";

  return (
    <div className="grid gap-6">
      <PanelSection title="Needs you" sub="Only what the autopilot couldn't settle on its own.">
        <NeedsYouStrip
          empty="Nothing is waiting on you. Every price inside the guardrails went out on its own."
          items={data.needsYou.map((item) => ({
            id: item.id,
            summary: item.summary,
            detail: item.kind === "price_held" ? item.detail : null,
            who: item.kind === "proposal_overdue" ? item.assignee : null,
            open: item.jobId ? { kind: "sales.job", id: item.jobId } : null,
            actions: item.kind === "backlog" ? null : <ExceptionButtons id={item.id} jobId={item.jobId} kind={item.kind} />,
          }))}
        />
      </PanelSection>

      <PanelSection title="Sales against target" sub={`The last ${WINDOW_DAYS} days. Targets are the report's planning bands, mostly from vendors: calibrate them once a season of your own data is in.`}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KpiTile
            label="Lead response"
            value={kpis.leadResponseMinutes == null ? "—" : formatHours(kpis.leadResponseMinutes / 60)}
            target="< 5 min"
            tone={toneFor(kpis.leadResponseMinutes, KPI_BANDS.leadResponseMinutes)}
            note={`Median, new client to first message, ${kpis.leads} leads.`}
          />
          <KpiTile label="Booked rate" value={pct(kpis.bookedRate)} target="≥ 70%" tone={toneFor(kpis.bookedRate, KPI_BANDS.bookedRate)} note="Leads who booked an evaluation." />
          <KpiTile label="Show rate" value={pct(kpis.showRate)} target="≥ 90%" tone={toneFor(kpis.showRate, KPI_BANDS.showRate)} note={KPI_BANDS.showRate.source} />
          <KpiTile
            label="Speed to proposal"
            value={formatHours(speed.medianHours)}
            target="< 2 h"
            tone={speedTone}
            note={`${pct(speed.withinTarget)} inside ${settings.speedTargetHours} h · ${pct(speed.sameDay)} same day. ${SPEED_CLAIM.source}: ${pct(SPEED_CLAIM.fastCloseRate)} vs ${pct(SPEED_CLAIM.slowCloseRate)} close.`}
          />
          <KpiTile
            label="Close rate"
            value={pct(kpis.closeRate)}
            target="45–55%"
            tone={kpis.decided < 3 ? "neutral" : toneFor(kpis.closeRate, KPI_BANDS.closeRate)}
            note={`${kpis.decided} decided. ${KPI_BANDS.closeRate.source}`}
          />
          <KpiTile label="Average ticket" value={usd(kpis.averageTicket)} target="$5,000" tone={toneFor(kpis.averageTicket, KPI_BANDS.averageTicket)} note={KPI_BANDS.averageTicket.source} />
          <KpiTile
            label="Pipeline value"
            value={usd(kpis.pipelineValue)}
            target="no band"
            tone="neutral"
            note={`${kpis.openProposals} open proposals${kpis.weightedPipeline != null ? `, worth ${usd(kpis.weightedPipeline)} at your close rate` : ""}.`}
          />
          <KpiTile label="Overdue now" value={String(speed.overdue)} target="0" tone={speed.overdue === 0 ? "good" : speed.overdue <= 2 ? "warn" : "bad"} note="Submitted, not sent, past the speed target." />
        </div>
      </PanelSection>

      <PanelSection
        title="Autopilot"
        sub={`A price goes out on its own when every line has a rate, the margin meets its division's target, and it is within ±${Math.round(settings.tolerance * 100)}% of the formula. Anything else is held above with the reason.`}
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border bg-card p-3">
            <p className="font-mono text-2xl">{activity.approved}</p>
            <p className="text-xs text-muted-foreground">approved this week</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="font-mono text-2xl">{activity.sent}</p>
            <p className="text-xs text-muted-foreground">sent on their own</p>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="font-mono text-2xl">{activity.held}</p>
            <p className="text-xs text-muted-foreground">held for a person</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {!settings.ready
            ? "Not set up yet."
            : settings.autoApprove
              ? `On${settings.autoSend ? ", sending" : ", approving only"}. ${activity.lastCheckAt ? `Last check ${new Date(activity.lastCheckAt).toLocaleString("en-US", { timeZone: "America/New_York" })}.` : "No proposal checked yet."} Runs when an evaluation is submitted, and every 15 minutes. Targets: ${DIVISIONS.map((d) => `${DIVISION_LABEL[d].toLowerCase()} ${Math.round(settings.targets[d] * 100)}%`).join(", ")}.`
              : "Off. Every price waits for a person."}
        </p>
        <AutopilotSettingsForm
          settings={{
            ready: settings.ready,
            autoApprove: settings.autoApprove,
            autoSend: settings.autoSend,
            startedAt: settings.startedAt,
            targets: settings.targets,
            tolerance: settings.tolerance,
            speedTargetHours: settings.speedTargetHours,
            overdueExceptions: settings.overdueExceptions,
            overdueStartedAt: settings.overdueStartedAt,
            offerOptions: settings.offerOptions,
            mhicLicense: settings.mhicLicense,
          }}
        />
      </PanelSection>

      <PanelSection
        title="Rate coverage"
        sub={`${coverage.withRate} of ${coverage.active} active services have a rate. A service with no rate holds every price it is on: fill them in here.`}
      >
        <RateCoverage missing={coverage.missing} duplicates={coverage.duplicates} />
      </PanelSection>
    </div>
  );
}
