"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { UNTAGGED, adsTracker, finalUrlSuffix } from "@/lib/ads-tracker";
import type { DatedAdSpend } from "@/lib/data/ads-tracker";
import type { LeadRecord } from "@/lib/data/lead-sources";

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Every Google Ads campaign on one page: spend, clicks, leads, jobs sold,
 * money back, and the tracked link each campaign's ads need.
 */
export function GoogleAdsTracker({ spend, leads, now }: { spend: DatedAdSpend[]; leads: LeadRecord[]; now: string }) {
  const [days, setDays] = useState(90);
  const [copied, setCopied] = useState<string | null>(null);
  const rows = useMemo(() => {
    const since = new Date(now).getTime() - days * 86_400_000;
    const sinceDay = new Date(since).toISOString().slice(0, 10);
    return adsTracker(
      spend.filter((s) => s.day >= sinceDay),
      leads.filter((l) => new Date(l.createdAt).getTime() >= since)
    );
  }, [spend, leads, days, now]);
  const total = rows.reduce(
    (t, r) => ({ spend: t.spend + r.spend, clicks: t.clicks + r.clicks, leads: t.leads + r.leads, sold: t.sold + r.sold, collected: t.collected + r.collected }),
    { spend: 0, clicks: 0, leads: 0, sold: 0, collected: 0 }
  );
  const untagged = rows.find((r) => r.campaign === UNTAGGED && r.leads > 0);
  const copy = async (campaign: string) => {
    try {
      await navigator.clipboard.writeText(finalUrlSuffix(campaign));
      setCopied(campaign);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section id="google-ads" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Google Ads</h2>
          <p className="text-sm text-muted-foreground">What each campaign cost and what it brought back.</p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <Button key={p.days} size="sm" variant={p.days === days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Spent", money(total.spend)],
          ["Clicks", total.clicks.toLocaleString("en-US")],
          ["Leads", String(total.leads)],
          ["Jobs sold", String(total.sold)],
          ["Clients paid", money(total.collected)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No Google Ads spend or leads in this period. Connect Google Ads in Settings › Integrations to bring the spend in.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Campaign</th>
                <th className="py-1 pr-2 text-right font-medium">Spent</th>
                <th className="py-1 pr-2 text-right font-medium">Clicks</th>
                <th className="py-1 pr-2 text-right font-medium">Leads</th>
                <th className="py-1 pr-2 text-right font-medium">Per lead</th>
                <th className="py-1 pr-2 text-right font-medium">Sold</th>
                <th className="py-1 pr-2 text-right font-medium">Clients paid</th>
                <th className="py-1 pr-2 text-right font-medium">Back per $1</th>
                <th className="py-1 font-medium">Tracked link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.campaign} className="border-t border-border/60">
                  <td className="py-2 pr-2 font-medium">{r.campaign}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{money(r.spend)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.clicks}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.leads}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.costPerLead == null ? "—" : money(r.costPerLead)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.sold}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{money(r.collected)}</td>
                  <td
                    className={`py-2 pr-2 text-right font-semibold tabular-nums ${
                      r.returnPerDollar == null ? "" : r.returnPerDollar >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {r.returnPerDollar == null ? "—" : `$${r.returnPerDollar.toFixed(2)}`}
                  </td>
                  <td className="py-2">
                    {r.campaign === UNTAGGED ? (
                      <span className="text-xs text-muted-foreground">Add the link</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => copy(r.campaign)}>
                        {copied === r.campaign ? "Copied" : "Copy"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Every ad needs its tracked link so each job is traced to the campaign that found it. In Google Ads, open the campaign, then Settings › Campaign URL
        options › Final URL suffix, and paste what Copy gives you.
        {untagged ? ` ${untagged.leads} lead${untagged.leads === 1 ? "" : "s"} from Google came in without a campaign on the link.` : ""}
      </p>
    </section>
  );
}
