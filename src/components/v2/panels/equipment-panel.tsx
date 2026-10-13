import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadEquipmentPanel } from "@/lib/data/equipment";
import { untyped } from "@/lib/data/purchasing";
import { EQUIPMENT_TYPE_LABEL, typeOf, type DueState, type EquipmentType } from "@/lib/equipment/maintenance";
import {
  AssetMeterForm,
  DismissAlert,
  EquipmentSettingsForm,
  IntervalRow,
  MarkDone,
  NewInterval,
} from "@/components/v2/panels/equipment-controls";

/**
 * Operations › Materials & equipment: equipment upkeep, kits and load-out.
 *
 * Overdue service and missed load-outs first, then how the fleet is doing
 * against target, then every task that is due or soon due with a button to
 * log it, the machines and what their meters read, the intervals (seeded
 * defaults marked as such), and the switches.
 */

const STATE_LABEL: Record<DueState, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  never_logged: "Never logged",
  ok: "OK",
};

const STATE_CLASS: Record<DueState, string> = {
  overdue: "bg-red-50 dark:bg-red-950/40",
  due_soon: "bg-yellow-50 dark:bg-yellow-950/40",
  never_logged: "bg-muted",
  ok: "bg-muted",
};

function Kpi({ label, value, target, tone }: { label: string; value: string; target: string; tone: "good" | "warn" | "bad" | "none" }) {
  const toneClass =
    tone === "good" ? "border-green-300 dark:border-green-800" : tone === "warn" ? "border-yellow-300 dark:border-yellow-800" : tone === "bad" ? "border-red-300 dark:border-red-800" : "";
  return (
    <div className={`rounded-xl border bg-card p-4 ${toneClass}`}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground">Target {target}</div>
    </div>
  );
}

export async function EquipmentPanel() {
  const organizationId = await getCurrentOrganizationId();
  const sb = untyped(await createClient());
  const data = await loadEquipmentPanel(sb, organizationId);

  if (!data.settings.ready) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-bold">Equipment upkeep</h2>
        <p className="mt-1 text-sm text-muted-foreground">Service intervals aren&apos;t set up yet. The database change for them (migration 0360) hasn&apos;t been applied.</p>
      </section>
    );
  }

  const assetById = new Map(data.assets.map((a) => [a.id, a]));
  const overdue = data.due.filter((d) => d.state === "overdue");
  const soon = data.due.filter((d) => d.state === "due_soon");
  const neverLogged = data.due.filter((d) => d.state === "never_logged");
  const showTasks = [...overdue, ...soon];
  const loadoutPct = data.loadoutToday.people ? Math.round((data.loadoutToday.complete / data.loadoutToday.people) * 100) : null;

  // Group "never logged" by machine, so a new truck reads as one line, not six.
  const neverByAsset = new Map<string, string[]>();
  for (const d of neverLogged) neverByAsset.set(d.assetId, [...(neverByAsset.get(d.assetId) ?? []), d.task]);

  return (
    <section className="grid gap-4" aria-labelledby="equipment-title">
      <h2 id="equipment-title" className="text-lg font-bold">
        Equipment, kits &amp; load-out
      </h2>

      {/* Needs you */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Needs you</h3>
        {data.alerts.length === 0 && data.loadoutExceptions.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing overdue, nobody left without their load-out.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/40">
                <span className="font-medium">{a.summary}</span>
                <span className="flex flex-wrap gap-2">
                  <MarkDone assetId={a.assetId} task={a.task} meter={assetById.get(a.assetId)?.meter ?? "none"} />
                  <DismissAlert id={a.id} />
                </span>
              </li>
            ))}
            {data.loadoutExceptions.map((e) => (
              <li key={e.id} className="rounded-lg bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/40">
                <Link className="font-medium underline" href={`/jobs/${e.jobId}`}>
                  {e.summary}
                </Link>
                {e.detail && <span className="block text-muted-foreground">{e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Service overdue" value={String(overdue.length)} target="0" tone={overdue.length ? "bad" : "good"} />
        <Kpi label={`Due within ${data.settings.dueSoonDays} days`} value={String(soon.length)} target="booked in" tone={soon.length > 5 ? "warn" : "none"} />
        <Kpi
          label="Crew with load-out ticked today"
          value={loadoutPct == null ? "—" : `${loadoutPct}%`}
          target="100%"
          tone={loadoutPct == null ? "none" : loadoutPct === 100 ? "good" : loadoutPct >= 75 ? "warn" : "bad"}
        />
        <Kpi label="Visits in 2 weeks with no kits" value={String(data.visitsWithoutKits)} target="0" tone={data.visitsWithoutKits ? "warn" : "good"} />
      </div>

      {/* Due and overdue */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Service due</h3>
        {showTasks.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing overdue or due soon.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {showTasks.map((d) => (
              <li key={`${d.assetId}-${d.intervalId}`} className={`grid gap-2 rounded-lg p-3 text-sm ${STATE_CLASS[d.state]}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium">{d.assetName}</span> · {d.task}
                  </span>
                  <span className="font-semibold">{STATE_LABEL[d.state]}</span>
                </div>
                <div className="text-muted-foreground">
                  {d.reason}
                  {d.lastDoneOn && ` · last done ${d.lastDoneOn}`}
                </div>
                <MarkDone assetId={d.assetId} task={d.task} meter={assetById.get(d.assetId)?.meter ?? "none"} />
              </li>
            ))}
          </ul>
        )}
        {neverByAsset.size > 0 && (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm">
              {neverLogged.length} task{neverLogged.length === 1 ? "" : "s"} never logged. Say when each was last done to start tracking it.
            </summary>
            <ul className="grid gap-2">
              {[...neverByAsset].map(([assetId, tasks]) => (
                <li key={assetId} className="rounded-lg bg-muted p-3 text-sm">
                  <div className="font-medium">{assetById.get(assetId)?.name}</div>
                  <ul className="mt-1 grid gap-2">
                    {tasks.map((task) => (
                      <li key={task} className="grid gap-1">
                        <span>{task}</span>
                        <MarkDone assetId={assetId} task={task} meter={assetById.get(assetId)?.meter ?? "none"} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Machines */}
      <details className="rounded-xl border bg-card p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Machines and meters · {data.assets.length}</summary>
        {data.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No machines yet. Add trucks, trailers, mowers and the rest on <Link className="underline" href="/admin/fleet">Fleet</Link>.
          </p>
        ) : (
          <ul className="grid gap-3">
            {data.assets.map((a) => (
              <li key={a.id} className="rounded-lg bg-muted p-2">
                <AssetMeterForm asset={a} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {data.usageLoggedToday} end-of-day log{data.usageLoggedToday === 1 ? "" : "s"} today. The crew logs hours and miles from their day screen.
        </p>
      </details>

      {/* Intervals */}
      <details className="rounded-xl border bg-card p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Service intervals · {data.intervals.length}</summary>
        <p className="text-sm text-muted-foreground">
          Whichever comes first. The ones marked default are starting points from common manufacturer schedules; change them to match your manuals.
        </p>
        <ul className="mt-2 grid gap-2">
          {data.intervals
            .slice()
            .sort((a, b) => (a.assetName ?? a.equipmentType ?? "").localeCompare(b.assetName ?? b.equipmentType ?? "") || a.task.localeCompare(b.task))
            .map((i) => (
              <li key={i.id}>
                <IntervalRow
                  interval={i}
                  label={i.assetName ? `Only ${i.assetName}` : `Every ${EQUIPMENT_TYPE_LABEL[(i.equipmentType ?? "other") as EquipmentType]?.toLowerCase() ?? i.equipmentType}`}
                />
              </li>
            ))}
        </ul>
        <div className="mt-3">
          <h4 className="text-sm font-semibold">Add an interval</h4>
          <NewInterval assets={data.assets} />
        </div>
        {data.assets.some((a) => typeOf(a) === "other") && (
          <p className="mt-2 text-xs text-muted-foreground">Machines typed &quot;Other&quot; get no default intervals. Set their type under Machines and meters.</p>
        )}
      </details>

      {/* Automation */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold">Automation</h3>
        <EquipmentSettingsForm settings={data.settings} />
        <p className="mt-2 text-xs text-muted-foreground">
          Kits are defined on <Link className="underline" href="/admin/tools/kits">Kit checklists</Link>; which tools each service needs on{" "}
          <Link className="underline" href="/admin/tools">Inventory</Link>.
        </p>
      </div>
    </section>
  );
}
