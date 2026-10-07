"use client";

import { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { summariseSources } from "@/lib/lead-sources";
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
export function LeadSourcesPanel({ leads, now }: { leads: LeadRecord[]; /** When the page was drawn, so the periods count back from one moment. */ now: string }) {
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
      <p className="mt-3 text-xs text-muted-foreground">
        A lead counts once, under its most specific clue: an ad click, then the tracked link it came through, then a team member&apos;s booking link,
        door hangers, a client referral, the quick mow page, the old calendar, or what was typed when it was added. &ldquo;Booked online, no
        trail&rdquo; means it came in with none of those.
      </p>
    </section>
  );
}
