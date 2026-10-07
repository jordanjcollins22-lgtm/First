import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import type { Funnel } from "@/lib/mow-funnel";
import { percent } from "@/lib/mow-funnel";
import { dollars } from "@/lib/mow-price";
import { requestAlert, paidAlert } from "@/lib/mow-messages";
import { AlertsSwitch } from "@/components/mow/alerts-switch";

/**
 * The quick mow funnel on one page, level by level: how many people reached
 * each step, how many made it from the step before, how fast they were
 * called, and the money. Under it, the six levels and where each one stands.
 * Kept apart from the loading so it can be previewed.
 */
export function FunnelScoreboard({
  funnel,
  days,
  alertsOn,
  canSwitchAlerts,
  metaConnected,
  mowsPerDay,
}: {
  funnel: Funnel;
  days: number | null;
  alertsOn: boolean;
  canSwitchAlerts: boolean;
  metaConnected: boolean;
  mowsPerDay: number;
}) {
  const top = Math.max(1, ...funnel.steps.map((s) => s.count));
  const levels: { n: number; name: string; state: "on" | "off" | "next"; detail: React.ReactNode }[] = [
    {
      n: 1,
      name: "Traffic",
      state: "on",
      detail: "Ads and posts point at the tracked link (grass26), so every tap is counted above. Point your Meta ads at it too.",
    },
    { n: 2, name: "Landing page", state: "on", detail: "One page, one job: check the address, get a price, book. No menu, nowhere else to go." },
    {
      n: 3,
      name: "Qualify, and tell Meta",
      state: metaConnected ? "on" : "off",
      detail: metaConnected
        ? "Only people in the area who give their details (Lead) or pay (Purchase) are reported to Meta, so the ads learn from buyers."
        : "The area check and lawn size qualify people now. Reporting buyers to Meta switches on when your Meta Pixel ID and Conversions API token are added to the app's settings.",
    },
    { n: 4, name: "Book a day", state: "on", detail: `They pick their first mow day at checkout, up to ${mowsPerDay} first mows a day, and it goes straight on the calendar.` },
    {
      n: 5,
      name: "Call within 2 minutes",
      state: alertsOn ? "on" : "off",
      detail: (
        <>
          The pipeline shows a 2-minute clock on every new request and payment, and the before-your-mow email is one tap (you read it before it sends).{" "}
          {alertsOn ? "Team alerts are on: account managers and owners are texted the moment it happens." : "Team alerts are off until you turn them on."}
        </>
      ),
    },
    { n: 6, name: "Track sales", state: "on", detail: "This page: clicks to revenue, and the call speed, by link." },
    {
      n: 7,
      name: "Buyers write the ads",
      state: "next",
      detail: "Not built yet: run sales call recordings through AI to find why people bought, in their words, and turn that into the next ads.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <Link href="/mow-orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Quick mow pipeline
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Quick mow funnel</h1>
          <p className="mt-1 text-sm text-muted-foreground">From a tap on the link to money in the bank, and where people drop off.</p>
        </div>
        <nav className="flex gap-1 rounded-full border border-border bg-card p-1 text-sm" aria-label="Period">
          {[
            { label: "7 days", value: 7 },
            { label: "30 days", value: 30 },
            { label: "All time", value: null },
          ].map((p) => (
            <Link
              key={p.label}
              href={p.value ? `/mow-orders/funnel?days=${p.value}` : "/mow-orders/funnel?days=all"}
              className={`rounded-full px-3 py-1 font-medium ${days === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Revenue" value={dollars(funnel.revenueCents)} />
        <Tile label="Paid" value={String(funnel.steps.find((s) => s.key === "paid")?.count ?? 0)} />
        <Tile label="Called within 2 min" value={percent(funnel.calledInTimeShare)} hint={funnel.calledCount ? `of ${funnel.calledCount} called` : "nobody called yet"} />
        <Tile label="Link to paid" value={percent(funnel.steps[0].count ? (funnel.steps.find((s) => s.key === "paid")?.count ?? 0) / funnel.steps[0].count : null)} />
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">The funnel</h2>
        <ol className="space-y-2">
          {funnel.steps.map((s) => (
            <li key={s.key} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_6rem]">
              <span className="truncate">{s.label}</span>
              <span className="h-6 overflow-hidden rounded-md bg-muted">
                <span className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-bold text-primary-foreground" style={{ width: `${Math.max(4, (s.count / top) * 100)}%` }}>
                  {s.count}
                </span>
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">{s.fromPrevious == null ? "" : `${percent(s.fromPrevious)} of above`}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">By link</h2>
        {funnel.byLink.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Link</th>
                  <th className="px-3 py-2 text-right font-medium">Requests</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {funnel.byLink.map((l) => (
                  <tr key={l.code} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{l.code}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.requests}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.paid}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dollars(l.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">The levels</h2>
        <ol className="space-y-2">
          {levels.map((l) => (
            <li key={l.n} className="flex gap-3 rounded-xl border border-border bg-card p-3 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{l.n}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {l.name}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      l.state === "on" ? "bg-emerald-100 text-emerald-800" : l.state === "off" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {l.state === "on" ? "Working" : l.state === "off" ? "Needs switching on" : "Next"}
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{l.detail}</p>
                {l.n === 5 && (
                  <div className="mt-2 space-y-2">
                    <AlertsSwitch on={alertsOn} canSwitch={canSwitchAlerts} />
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium text-primary">What the alerts say</summary>
                      <p className="mt-1 rounded-md bg-muted/50 p-2">{requestAlert({ name: "Alex Sample", phone: "(410) 555-0100", address: "12 Sample Ct, Bel Air", price: "$46" })}</p>
                      <p className="mt-1 rounded-md bg-muted/50 p-2">{paidAlert({ name: "Alex Sample", phone: "(410) 555-0100", address: "12 Sample Ct, Bel Air", paid: "$46", day: "Tue, Oct 6" })}</p>
                    </details>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
