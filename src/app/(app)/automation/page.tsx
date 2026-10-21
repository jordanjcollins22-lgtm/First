import Link from "next/link";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/data/team";
import { getAttention, type AttentionItem } from "@/lib/data/automation-attention";
import { resolveWorkflowTask, setAutomationControls } from "@/lib/actions/automation-actions";
import { isOwnerLevel } from "@/lib/roles";

/**
 * Everything waiting on a person, in one list, worst first.
 *
 * Issues, field exceptions, sales and client-message exceptions, emails held
 * for approval, automations that gave up, and the tasks the event backbone
 * opened. Nothing is left off because some other number looks fine. Under
 * it, whether the automations are healthy, and the owner's switch.
 */
export default async function AutomationPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || !isOwnerLevel(profile.roles)) redirect("/my-day");

  const attention = await getAttention();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Needs a person</h1>
      <p className="mb-6 text-sm text-muted-foreground sm:text-base">
        Everything waiting on somebody, worst first. Automations decide on paper until you switch them live.
      </p>

      {attention == null ? (
        <p className="rounded-md border border-border p-4 text-sm">
          The automation tables are not in this database yet. Once migrations 0370 and 0371 are applied, this page fills in.
        </p>
      ) : (
        <>
          <ItemList items={attention.items} />
          <Health health={attention.health} />
        </>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  job_issue: "Issue",
  job_exception: "Field exception",
  sales_exception: "Sales",
  client_automation_exception: "Client messages",
  outbound_approval: "Email to approve",
  automation_action: "Automation",
  workflow_task: "Task",
};

function ItemList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return <p className="mb-8 rounded-md border border-border p-4 text-sm">Nothing is waiting on anybody.</p>;
  }
  return (
    <ul className="mb-8 divide-y divide-border rounded-md border border-border">
      {items.map((item) => (
        <li key={`${item.source}:${item.id}`} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant={item.severity === "critical" || item.blocking ? "destructive" : "outline"}>{item.severity}</Badge>
              <span className="text-xs text-muted-foreground">{SOURCE_LABEL[item.source] ?? item.source}</span>
              {item.dueAt && <span className="text-xs text-muted-foreground">due {new Date(item.dueAt).toLocaleString()}</span>}
            </div>
            <p className="text-sm">
              {item.jobId ? (
                <Link href={`/jobs/${item.jobId}`} className="hover:underline">
                  {item.summary}
                </Link>
              ) : (
                item.summary
              )}
            </p>
          </div>
          {item.source === "workflow_task" && (
            <form action={resolveWorkflowTask} className="flex shrink-0 gap-2">
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" size="sm" variant="outline">
                Done
              </Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

function Health({ health }: { health: NonNullable<Awaited<ReturnType<typeof getAttention>>>["health"] }) {
  const { controls } = health;
  const state = controls.paused ? "Paused" : !controls.eventsEnabled ? "Off" : controls.dryRun ? "Dry run" : "Live";
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-1 text-lg font-semibold">Automations: {state}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {health.eventsToday} facts recorded today. {health.pending} waiting to be handled, {health.failing} retrying, {health.dead} gave up.
        This week, {health.proposedThisWeek} follow-ups would have gone and {health.skippedThisWeek} were held back.
      </p>
      <form action={setAutomationControls} className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="events_enabled" defaultChecked={controls.eventsEnabled} />
          Record what happens (lead, visit, estimate, approval, payment)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="live" defaultChecked={!controls.dryRun} />
          Live: let automations act, not just decide on paper
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="paused" defaultChecked={controls.paused} />
          Pause everything
        </label>
        <input name="paused_reason" placeholder="Why paused (optional)" className="rounded-md border border-border px-2 py-1" />
        <div>
          <Button type="submit" size="sm">
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
