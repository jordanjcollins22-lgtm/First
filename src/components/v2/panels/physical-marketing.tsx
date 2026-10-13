import { loadPhysicalPanel, type PlayRow } from "@/lib/data/marketing-panels";
import { getRealProfile } from "@/lib/data/team";
import { isApproved, KIND_LABEL, playTitle, REASON_LABEL, shortAddress } from "@/lib/marketing-plays";
import { isStale } from "@/lib/marketing/play-closure";

import { AutomationSwitches, ExpireBacklogButton, money, NumberSettings, PlayActions, WalkTracker } from "./marketing-autopilot-controls";
import { Kpi, NeedsYou, pct, Section, type NeedsYouItem } from "./marketing-panel-parts";

/**
 * Marketing › Physical marketing: the plays (signs, knocks, hangers,
 * flyers) by status, who has each one, and what the finished ones cost per
 * lead. Plays now close themselves (walked, finished, or tapped done by
 * whoever has them) and expire after a month of nothing; this is where a
 * person assigns, closes by hand, and sees whether hangers pay.
 */

const CLOSED_LABEL: Record<string, string> = {
  gps: "walked (GPS)",
  crew_finished: "crew finished the job",
  assignee: "tapped done",
  owner: "closed by hand",
  expired: "expired",
};

function PlayLine({ play, people, owned }: { play: PlayRow; people: { id: string; name: string; affiliate: boolean }[]; owned: boolean }) {
  const open = play.status === "open";
  return (
    <li className="grid gap-2 rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-bold">{playTitle(play)}</span>
        <span className="text-muted-foreground">
          {KIND_LABEL[play.kind]} · {REASON_LABEL[play.reason]} · {shortAddress(play.address)}
          {play.customerName ? ` (${play.customerName})` : ""}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">made {new Date(play.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
      {!open && (
        <p className="text-xs text-muted-foreground">
          {play.status === "done" ? "Done" : "Skipped"}
          {play.closedReason ? `: ${CLOSED_LABEL[play.closedReason] ?? play.closedReason}` : ""}
          {play.closedNote ? `. ${play.closedNote}` : ""}
          {play.status === "done" && play.costCents != null ? ` · cost ${money(play.costCents)} · ${play.leads} lead${play.leads === 1 ? "" : "s"}, ${play.sold} sold` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <PlayActions playId={play.id} assignedTo={play.assignedTo ?? null} people={people} open={open} />
        {open && owned && play.kind !== "flyers" && isApproved(play.approval) && <WalkTracker playId={play.id} />}
      </div>
    </li>
  );
}

export async function PhysicalMarketingPanel() {
  const [d, me] = await Promise.all([loadPhysicalPanel(), getRealProfile()]);
  const { settings, started } = d.autopilot;
  const now = new Date();

  const open = d.plays.filter((p) => p.status === "open");
  const pending = open.filter((p) => !isApproved(p.approval));
  const ready = open.filter((p) => isApproved(p.approval));
  const closed = d.plays.filter((p) => p.status !== "open").slice(0, 30);
  const stale = open.filter((p) => isStale({ ...p, approval: p.approval ?? null, approvedAt: p.approvedAt ?? null, assignedAt: p.assignedAt ?? null }, now, settings.playExpiryDays));
  const hangers = d.byKind.find((k) => k.kind === "door_hangers");

  const needs: NeedsYouItem[] = [];
  if (d.unassigned.length > 0) needs.push({ key: "unassigned", text: `${d.unassigned.length} approved play${d.unassigned.length === 1 ? " has" : "s have"} had nobody assigned for more than 3 days.` });
  if (pending.length > 0) needs.push({ key: "pending", text: `${pending.length} play${pending.length === 1 ? "" : "s"} waiting for approval (the app approves a kind on its own after 3 untouched approvals).`, href: "/attractors", action: "Review" });

  return (
    <div className="grid gap-4">
      <NeedsYou items={needs} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Open plays" value={String(d.totals.open)} />
        <Kpi
          label="Closed within 7 days"
          value={pct(d.closedWithinWeek)}
          target="≥ 80%"
          tone={d.closedWithinWeek == null ? "none" : d.closedWithinWeek >= 0.8 ? "good" : d.closedWithinWeek >= 0.5 ? "warn" : "bad"}
        />
        <Kpi label="Door hangers: cost per lead" value={money(hangers?.costPerLeadCents ?? null)} target="from finished rounds" />
        <Kpi label="Done / expired, 90 days" value={`${d.totals.done90} / ${d.totals.expired90}`} />
      </div>

      <Section title="Cost per lead by kind" hint="Bookings from addresses in a play's zone within 60 days of the drop, against what the play cost when it closed.">
        {d.byKind.length === 0 ? (
          <p className="text-sm text-muted-foreground">No finished plays with a cost yet. Close a round and it shows here.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2 text-right">Plays</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Leads</th>
                  <th className="px-3 py-2 text-right">Sold</th>
                  <th className="px-3 py-2 text-right">Per lead</th>
                </tr>
              </thead>
              <tbody>
                {d.byKind.map((k) => (
                  <tr key={k.kind} className="border-t">
                    <td className="px-3 py-2 font-medium">{KIND_LABEL[k.kind]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.plays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(k.costCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.leads}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.sold}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(k.costPerLeadCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Ready to go (${ready.length})`} hint="Approved. Give each to a walker or an affiliate; it closes itself when walked, when the crew finishes the job, or when they tap Done.">
        {ready.length === 0 ? <p className="text-sm text-muted-foreground">Nothing approved and open.</p> : (
          <ul className="grid gap-2">
            {ready.map((p) => (
              <PlayLine key={p.id} play={p} people={d.people} owned={Boolean(me && p.assignedTo === me.id)} />
            ))}
          </ul>
        )}
      </Section>

      {pending.length > 0 && (
        <Section title={`Waiting for approval (${pending.length})`} hint="Approve or edit the doors on the map (Attractors); assigning or tapping Done here approves it too.">
          <ul className="grid gap-2">
            {pending.slice(0, 20).map((p) => (
              <PlayLine key={p.id} play={p} people={d.people} owned={false} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recently closed">
        {closed.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="grid gap-2">
            {closed.map((p) => (
              <PlayLine key={p.id} play={p} people={d.people} owned={false} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="What runs on its own" hint="Each switch remembers when it was first turned on and only acts on plays made after that.">
        <AutomationSwitches keys={["plays_auto_approve", "hangers_default_approve", "plays_auto_close", "plays_expire"]} settings={settings} started={started} />
        <NumberSettings
          fields={[
            { key: "hanger", label: "Door hanger, each", value: settings.unitCostCents.door_hangers / 100, suffix: "$", toSave: (v) => ({ unitCostCents: { ...settings.unitCostCents, door_hangers: Math.round(v * 100) } }) },
            { key: "flyer", label: "Flyer by mail, each", value: settings.unitCostCents.flyers / 100, suffix: "$", toSave: (v) => ({ unitCostCents: { ...settings.unitCostCents, flyers: Math.round(v * 100) } }) },
            { key: "sign", label: "Yard sign", value: settings.unitCostCents.yard_sign / 100, suffix: "$", toSave: (v) => ({ unitCostCents: { ...settings.unitCostCents, yard_sign: Math.round(v * 100) } }) },
            { key: "expiry", label: "Expire after", value: settings.playExpiryDays, suffix: "days", toSave: (v) => ({ playExpiryDays: v }) },
            { key: "coverage", label: "Walk must pass", value: Math.round(settings.gpsCoverage * 100), suffix: "% of doors", toSave: (v) => ({ gpsCoverage: v / 100 }) },
          ]}
        />
        <ExpireBacklogButton days={settings.playExpiryDays} count={stale.length} />
      </Section>
    </div>
  );
}
