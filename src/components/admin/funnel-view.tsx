import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FUNNEL_RANGES, type FunnelOverview } from "@/lib/data/funnel-stats";
import { cn } from "@/lib/utils";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function minutes(m: number | null): string {
  if (m == null) return "–";
  if (m < 1) return "under a minute";
  if (m < 90) return `${Math.round(m)} min`;
  if (m < 60 * 36) return `${Math.round(m / 60)} hr`;
  return `${Math.round(m / 1440)} days`;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const SOURCE_LABEL = { traced: "Traced by client", ai: "AI from picture", history: "Your history", typical: "Typical guess" } as const;

/**
 * The client funnel, one card per page: how many reached it, how many went
 * on, how many stopped there, and how long it took. The bar on each card is
 * that page's people against the booking page's, so the narrowing reads at
 * a glance. Its own component so it can be looked at with any figures.
 */
export function FunnelView({ overview }: { overview: FunnelOverview }) {
  const { stats, money: paid, estimates, days } = overview;
  const top = Math.max(1, stats.pages[0]?.reached ?? 0);
  const collected = paid.deposits.cents + paid.evaluations.cents;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Funnel</h1>
        <div className="flex gap-1" aria-label="Range">
          {FUNNEL_RANGES.map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                d === days ? "border-primary! bg-primary text-primary-foreground" : "border-border bg-card/60 hover:border-primary!"
              )}
            >
              {d} days
            </Link>
          ))}
        </div>
      </div>
      <p className="mb-6 text-muted-foreground">
        Each page a client goes through, from opening the booking page to booking their visit. A person counts once per
        page however many times they reload it.
      </p>

      {overview.problems.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40! bg-amber-500/10 px-3 py-2 text-sm">
          {overview.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Opened booking" value={stats.started.toLocaleString("en-US")} />
        <Tile label="Paid" value={stats.paid.toLocaleString("en-US")} note={stats.paidPct != null ? `${stats.paidPct}% of those who opened` : undefined} />
        <Tile label="Collected" value={money(collected)} note={`${paid.deposits.count} deposits, ${paid.evaluations.count} evaluations`} />
        <Tile label="Estimates sent" value={estimates.count.toLocaleString("en-US")} note={estimates.averageCents != null ? `average ${money(estimates.averageCents)}` : undefined} />
      </div>

      <ol className="flex flex-col gap-3">
        {stats.pages.map((p, i) => {
          const width = Math.round((p.reached / top) * 100);
          return (
            <li key={p.page.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                        {p.page.name}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{p.page.what}</p>
                    </div>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{p.page.path}</code>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Reached</dt>
                      <dd className="font-semibold">{p.reached.toLocaleString("en-US")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Went on</dt>
                      <dd className="font-semibold">
                        {p.completed.toLocaleString("en-US")}
                        {p.completionPct != null && <span className="font-normal text-muted-foreground"> ({p.completionPct}%)</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Stopped here</dt>
                      <dd className={cn("font-semibold", p.stopped > 0 && p.completionPct != null && p.completionPct < 50 && "text-red-600 dark:text-red-400")}>
                        {p.stopped.toLocaleString("en-US")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Typical time on it</dt>
                      <dd className="font-semibold">{minutes(p.medianMinutes)}</dd>
                    </div>
                  </dl>

                  {p.page.id === "map" && (
                    <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm text-muted-foreground">
                      <p>
                        {stats.tappedAfterOpening} of {p.reached} tapped at least one spot
                        {estimates.averageSpots != null ? `; estimates average ${estimates.averageSpots} spots` : ""}.
                      </p>
                      {estimates.count > 0 && (
                        <p>
                          Spots sized by:{" "}
                          {(Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[])
                            .map((k) => `${SOURCE_LABEL[k]} ${estimates.sizedBy[k]}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  )}
                  {p.page.id === "checkout" && stats.paidBy.length > 0 && (
                    <p className="border-t border-border pt-2 text-sm text-muted-foreground">
                      Paid for: {stats.paidBy.map((b) => `${b.label} ${b.count}`).join(" · ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
