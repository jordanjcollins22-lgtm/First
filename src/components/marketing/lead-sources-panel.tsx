"use client";

import { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { summariseSources } from "@/lib/lead-sources";
import { CHANNEL_PCT, COMMISSIONS_FROM, affiliateSplit } from "@/lib/channel-budget";
import { CONTENT_POOL_PCT, contentPool } from "@/lib/content-pool";
import type { LeadRecord } from "@/lib/data/lead-sources";

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Where every lead came from: one row per source with how many leads, how
 * many sold, the close rate and the money, longest bar first. Under each,
 * whose link or which campaign.
 */
export function LeadSourcesPanel({
  leads,
  team = [],
  now,
}: {
  leads: LeadRecord[];
  /** The marketing team, by first name, who share the content profit pool. */
  team?: string[];
  /** When the page was drawn, so the periods count back from one moment. */
  now: string;
}) {
  const [days, setDays] = useState(90);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const since = new Date(now).getTime() - days * 86_400_000;
    return summariseSources(leads.filter((l) => new Date(l.createdAt).getTime() >= since));
  }, [leads, days, now]);
  const total = rows.reduce((n, r) => n + r.leads, 0);
  const sold = rows.reduce((n, r) => n + r.sold, 0);
  const revenue = rows.reduce((n, r) => n + r.revenue, 0);
  const max = Math.max(1, ...rows.map((r) => r.leads));
  const split = useMemo(() => {
    const since = new Date(now).getTime() - days * 86_400_000;
    // Only jobs from the day commissions started being counted here.
    const from = Math.max(since, new Date(`${COMMISSIONS_FROM}T00:00:00Z`).getTime());
    return affiliateSplit(leads.filter((l) => new Date(l.createdAt).getTime() >= from));
  }, [leads, days, now]);
  const budgets = split.sources;
  const budgetTotal = budgets.reduce((n, b) => n + b.budget, 0);
  const peopleTotal = split.people.reduce((n, p) => n + p.cut, 0);
  const startedOn = new Date(`${COMMISSIONS_FROM}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const pool = useMemo(() => {
    const since = new Date(now).getTime() - days * 86_400_000;
    return contentPool(leads.filter((l) => new Date(l.createdAt).getTime() >= since), team);
  }, [leads, team, days, now]);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Where leads come from</h2>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "lead" : "leads"} · {sold} sold · {money(revenue)}
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No leads in this period.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Source</th>
                <th className="py-1 pr-2 font-medium">Leads</th>
                <th className="py-1 pr-2 text-right font-medium">Sold</th>
                <th className="py-1 pr-2 text-right font-medium">Close rate</th>
                <th className="py-1 text-right font-medium">Sold for</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.group}>
                  <tr
                    className={`border-t border-border/60 ${r.details.length ? "cursor-pointer hover:bg-muted/40" : ""}`}
                    onClick={() => r.details.length && setOpen(open === r.group ? null : r.group)}
                  >
                    <td className="py-2 pr-2 font-medium">
                      {r.group}
                      {r.details.length > 0 && <span className="ml-1 text-xs text-muted-foreground">{open === r.group ? "▾" : "▸"}</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, (r.leads / max) * 160)}px` }} />
                        <span className="tabular-nums">{r.leads}</span>
                        <span className="text-xs text-muted-foreground">{Math.round((r.leads / total) * 100)}%</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.sold}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.leads ? `${Math.round((r.sold / r.leads) * 100)}%` : "–"}</td>
                    <td className="py-2 text-right tabular-nums">{r.revenue ? money(r.revenue) : "–"}</td>
                  </tr>
                  {open === r.group &&
                    r.details.map((d) => (
                      <tr key={`${r.group}:${d.name}`} className="text-xs text-muted-foreground">
                        <td className="py-1 pl-4 pr-2">{d.name}</td>
                        <td className="py-1 pr-2 tabular-nums" colSpan={4}>
                          {d.leads} {d.leads === 1 ? "lead" : "leads"}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-5" id="growth-budget">
        <h3 className="text-base font-bold">Affiliate {CHANNEL_PCT}%: people and other sources</h3>
        <p className="text-sm text-muted-foreground">
          Every job pays an affiliate {CHANNEL_PCT}% of what the client paid. If a person brought it in, it goes to that person. If it came from
          anything else (an ad, a post, an automation, the calendar), it goes back into ads on that channel. Counted from {startedOn}; older
          jobs are in the lead sources above but not paid on.
        </p>
        <p className="mt-2 text-sm font-semibold">
          Sent out: {money(peopleTotal + budgetTotal)} ({money(peopleTotal)} to people, {money(budgetTotal)} back into ads)
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">From people</p>
            <p className="text-lg font-bold tabular-nums">
              {split.peopleLeads} {split.peopleLeads === 1 ? "lead" : "leads"} · {money(peopleTotal)}
            </p>
            <p className="text-xs text-muted-foreground">paid to them</p>
          </div>
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">From other sources</p>
            <p className="text-lg font-bold tabular-nums">
              {split.sourceLeads} {split.sourceLeads === 1 ? "lead" : "leads"} · {money(budgetTotal)}
            </p>
            <p className="text-xs text-muted-foreground">back into ads</p>
          </div>
        </div>

        <h4 className="mt-4 text-sm font-semibold">From people: paid to that person</h4>
        {split.people.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No paid jobs brought in by a person since {startedOn}.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Person</th>
                  <th className="py-1 pr-2 text-right font-medium">Paid jobs</th>
                  <th className="py-1 pr-2 text-right font-medium">Clients paid</th>
                  <th className="py-1 text-right font-medium">Their {CHANNEL_PCT}%</th>
                </tr>
              </thead>
              <tbody>
                {split.people.map((p) => (
                  <tr key={p.name} className="border-t border-border/60">
                    <td className="py-2 pr-2 font-medium">{p.name}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{p.jobs}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{money(p.collected)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{money(p.cut)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border">
                  <td className="py-2 pr-2 font-semibold" colSpan={3}>Total to people</td>
                  <td className="py-2 text-right font-bold tabular-nums">{money(peopleTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <h4 className="mt-4 text-sm font-semibold">From other sources: back into ads on that channel</h4>
        {budgets.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No paid jobs from other sources since {startedOn}.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Channel</th>
                  <th className="py-1 pr-2 text-right font-medium">Paid jobs</th>
                  <th className="py-1 pr-2 text-right font-medium">Clients paid</th>
                  <th className="py-1 text-right font-medium">For its ads ({CHANNEL_PCT}%)</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.group} className="border-t border-border/60">
                    <td className="py-2 pr-2 font-medium">{b.group}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{b.jobs}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{money(b.collected)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{money(b.budget)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border">
                  <td className="py-2 pr-2 font-semibold" colSpan={3}>Total back into ads</td>
                  <td className="py-2 text-right font-bold tabular-nums">{money(budgetTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-5" id="content-pool">
        <h3 className="text-base font-bold">Content profit pool</h3>
        <p className="text-sm text-muted-foreground">
          {CONTENT_POOL_PCT}% of the profit (price less costs) on jobs that came from our posts, split evenly across the marketing team. A job only
          counts when it came in through a tracked link on the post, so put one on every post. When it is paid out is not decided yet.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">Jobs from content</p>
            <p className="text-lg font-bold tabular-nums">{pool.jobs}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">Profit on them</p>
            <p className="text-lg font-bold tabular-nums">{money(pool.profit)}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">Pool ({CONTENT_POOL_PCT}%)</p>
            <p className="text-lg font-bold tabular-nums">{money(pool.pool)}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">Each person</p>
            <p className="text-lg font-bold tabular-nums">{pool.team.length ? money(pool.perPerson) : "—"}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {pool.team.length
            ? `Split ${pool.team.length} ways: ${pool.team.join(", ")}.`
            : "Nobody on the marketing team yet. Anyone who hands out tracked links is on it."}
          {pool.unpriced > 0 ? ` ${pool.unpriced} job${pool.unpriced === 1 ? "" : "s"} from content had no profit worked out, so ${pool.unpriced === 1 ? "it is" : "they are"} not in the pool.` : ""}
        </p>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A lead counts once, under its most specific clue: an ad click, then the tracked link it came through, then a team member&apos;s booking link,
        door hangers, a client referral, the quick mow page, the old calendar, or what was typed when it was added. &ldquo;Booked online, no
        trail&rdquo; means it came in with none of those.
      </p>
    </section>
  );
}
