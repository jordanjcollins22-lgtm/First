"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/inventory-value";
import { CONDITIONS, percent, type AssetRisk } from "@/lib/fleet";
import { markBought, recordBreakdown } from "@/lib/actions/fleet-actions";
import type { FleetBoard } from "@/lib/data/fleet";

/**
 * What we run on, what it is likely to do to us, and when the next one lands.
 *
 * The order is the argument. The odds first, because they are what makes the
 * case; then what waiting costs, because a probability is not something
 * anybody acts on and a weekly dollar figure is; then the dates, because that
 * is the decision.
 */
export function FleetBoardView({ board }: { board: FleetBoard }) {
  const worst = board.risks[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border">
        <Figure
          label="Chance of a breakdown"
          value={worst ? percent(1 - board.risks.reduce((p, r) => p * (1 - r.in30Days), 1)) : "—"}
          detail="Somewhere in the fleet, in the next 30 days"
        />
        <Figure
          label="Cost of waiting"
          value={`${money(board.weeklyRisk)}/wk`}
          detail="What another week is expected to cost in breakdowns"
        />
      </div>

      {board.missing.length > 0 && (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          {board.missing.join(" ")}
        </p>
      )}

      <Plan board={board} />
      <Assets risks={board.risks} />
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Plan({ board }: { board: FleetBoard }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const unbought = board.plan;
  if (unbought.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nothing on the shopping list yet.
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">What we are buying, and when</h2>
        <p className="text-xs text-muted-foreground">
          {money(board.spendableCents / 100)} spendable today
          {board.tradeInCents > 0 && `, plus ${money(board.tradeInCents / 100)} from selling what it replaces`}
          {board.weeklyCents > 0 && `, and about ${money(board.weeklyCents / 100)} a week going in`}. Each one
          is bought after the one above it, out of the same money.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {unbought.map(({ target, when }) => (
          <li key={target.id} className="p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{target.name}</span>
              {target.costCents != null && (
                <span className="text-xs text-muted-foreground">{money(target.costCents / 100)}</span>
              )}
              {target.monthlyCents != null && target.monthlyCents > 0 && (
                <span className="text-xs text-muted-foreground">
                  {money(target.monthlyCents / 100)}/mo after
                </span>
              )}
              {target.url && (
                <a
                  href={target.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs underline"
                >
                  Look <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <p className="mt-1 text-sm">
              {when.affordableNow ? (
                <span className="font-medium text-primary">
                  Affordable now — {money(when.needCents / 100)} to collect it.
                </span>
              ) : when.on ? (
                <>
                  <span className="font-medium">
                    {money(when.needCents / 100)} needed, about {when.weeks} week
                    {when.weeks === 1 ? "" : "s"} away
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({new Date(`${when.on}T12:00:00Z`).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {money(when.needCents / 100)} needed. Nothing measurable is going in, so there is no
                  date to work towards yet.
                </span>
              )}
            </p>

            {/* The number that argues for financing rather than saving. A
                deposit eight weeks out, against a truck costing two hundred a
                week in expected breakdowns, is sixteen hundred of waiting. */}
            {when.waitingCostCents > 0 && (
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                Waiting that long is expected to cost {money(when.waitingCostCents / 100)} in
                breakdowns on what we are still running.
              </p>
            )}

            {target.notes && <p className="mt-1 text-xs text-muted-foreground">{target.notes}</p>}

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markBought({ id: target.id });
                  router.refresh();
                })
              }
              className="mt-2 min-h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              Bought it
            </button>
          </li>
        ))}
      </ul>

      <MonthlyLine board={board} />
    </section>
  );
}

/**
 * What the swap does to the monthly bill.
 *
 * The comparison that is hardest to hold in your head: a payment on a new
 * truck is not a new cost on top of the old one, it is a swap for insurance,
 * repairs and a trailer about to need a floor.
 */
function MonthlyLine({ board }: { board: FleetBoard }) {
  const { nowCents, afterCents, differenceCents } = board.swap;
  if (nowCents === 0 && afterCents === 0) return null;

  return (
    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
      Monthly now {money(nowCents / 100)}, and {money(afterCents / 100)} once the swap is done
      {differenceCents === 0
        ? "."
        : differenceCents > 0
          ? ` — ${money(differenceCents / 100)} a month more.`
          : ` — ${money(-differenceCents / 100)} a month less.`}
    </p>
  );
}

function Assets({ risks }: { risks: AssetRisk[] }) {
  if (risks.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        Ordered by what a failure would cost, not by how likely it is. A trailer nearly certain to
        need a bearing is a smaller problem than a truck that takes the week with it.
      </p>
      <ul className="divide-y divide-border">
        {risks.map((risk) => (
          <AssetRow key={risk.asset.id} risk={risk} />
        ))}
      </ul>
    </section>
  );
}

function AssetRow({ risk }: { risk: AssetRisk }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { asset } = risk;

  const description = [asset.year, asset.make, asset.model].filter(Boolean).join(" ");
  const condition = CONDITIONS.find((c) => c.key === asset.condition);

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{asset.name}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px]",
            asset.condition === "failing" || asset.condition === "poor"
              ? "bg-amber-500/15 font-medium text-amber-700 dark:text-amber-500"
              : "bg-muted text-muted-foreground"
          )}
        >
          {condition?.label ?? asset.condition}
        </span>
        {asset.breakdowns12mo > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            {asset.breakdowns12mo} breakdown{asset.breakdowns12mo === 1 ? "" : "s"} this year
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {percent(risk.in30Days)} chance in the next 30 days, {percent(risk.in90Days)} in 90.
        Expected cost of another week on it: {money(risk.weeklyCost)}.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await recordBreakdown({ id: asset.id });
              router.refresh();
            })
          }
          className="min-h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
        >
          It broke down
        </button>
        {asset.breakdowns12mo > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await recordBreakdown({ id: asset.id, undo: true });
                router.refresh();
              })
            }
            className="text-xs text-muted-foreground underline"
          >
            Undo
          </button>
        )}
      </div>
    </li>
  );
}
