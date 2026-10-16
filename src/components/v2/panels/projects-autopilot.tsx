import { cache } from "react";

import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadProjectsAutopilot } from "@/lib/data/ops-panels";
import { AutopilotSettingsForm, BacklogReview, NeedsYouStrip } from "@/components/v2/panels/ops-autopilot-client";
import { KpiGrid, NotReady, SectionTitle, shortDate } from "@/components/v2/panels/ops-shared";

/**
 * Operations › Projects: the closing loops, one screen per button.
 *
 * Needs you: a work day nobody closed by 9pm, a close-out the chain can't
 * move, a job auto-placement held, a crew member the lead didn't answer
 * about, a job over its hours. Project numbers: against target. Automatic:
 * each automation, its state, and its switches. One load for all three.
 */

const loadProjects = cache(async () => loadProjectsAutopilot(await getCurrentOrganizationId()));

export async function ProjectsNeedsPanel() {
  const data = await loadProjects();
  if (!data.ready) return <NotReady />;

  return (
    <div className="grid gap-3">
      <SectionTitle sub="Only what a person has to decide. Everything else closes itself.">Projects</SectionTitle>
      <NeedsYouStrip items={data.needsYou} />
      <BacklogReview sessions={data.backlog} />
    </div>
  );
}

export async function ProjectsNumbersPanel() {
  const data = await loadProjects();
  if (!data.ready) return <NotReady />;

  return (
    <div className="grid gap-3">
      <SectionTitle sub="Planning bands, mostly from vendors. A colour is a prompt to look, not a grade.">How projects are running</SectionTitle>
      <KpiGrid kpis={data.kpis} />
    </div>
  );
}

export async function ProjectsAutoPanel() {
  const data = await loadProjects();
  if (!data.ready) return <NotReady />;

  return (
    <div className="grid gap-3">
      <SectionTitle sub="Each one acts only on work after it went live.">Project automations</SectionTitle>
      <ul className="grid gap-2">
        {data.automations.map((a) => (
          <li key={a.key} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                a.on ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100" : "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100"
              }`}
            >
              {a.on ? "On" : "Off"}
            </span>
            <span className="min-w-0 flex-1 font-semibold">{a.name}</span>
            <span className="text-sm text-muted-foreground">
              Live since {shortDate(a.startedAt)} · last 7 days: {a.lastWeek}
            </span>
          </li>
        ))}
      </ul>
      <AutopilotSettingsForm settings={data.settings} sections={["Work days", "Completion chain", "Crew check-in", "Auto-placement"]} />
    </div>
  );
}
