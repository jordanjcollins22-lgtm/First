"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/inventory-value";
import { CADENCE_LABEL, KIND_LABEL, type ChargeKind } from "@/lib/recurring";
import { GROUP_LABEL, GROUP_ORDER } from "@/lib/overhead";
import {
  confirmCharge,
  dismissCharge,
  markForCancelling,
  setOverheadGroup,
} from "@/lib/actions/recurring-actions";
import type { ChargeRow, RecurringBoard } from "@/lib/data/recurring";

/**
 * What leaves the bank every month whether anybody works or not.
 *
 * Subscriptions and obligations are kept apart because the question each one
 * raises is different. A subscription is the same charge every month and the
 * question is "do we still use this". An obligation moves a bit and is not
 * optional, and the question is "what does this actually average". Together
 * they are a number that is neither a bill to pay nor a list to cancel.
 */
export function RecurringBoardView({ board }: { board: RecurringBoard }) {
  const [showDismissed, setShowDismissed] = useState(false);

  const visible = board.charges.filter((c) => showDismissed || !c.decision?.dismissedAt);
  const subscriptions = visible.filter((c) => c.kind === "subscription" && c.live);
  const obligations = visible.filter((c) => c.kind === "obligation" && c.live);
  const transfers = visible.filter((c) => c.kind === "transfer");
  const stopped = visible.filter((c) => !c.live && c.kind !== "transfer");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
        <Figure label="Subscriptions" value={money(board.totals.subscriptions)} detail={`${subscriptions.length} of them`} />
        <Figure label="Obligations" value={money(board.totals.obligations)} detail={`${obligations.length} of them`} />
        <Figure
          label="Overhead"
          value={money(board.overhead.monthly)}
          detail={`${money(board.overhead.yearly)} a year`}
        />
      </div>

      <Overhead board={board} />

      <Section
        title="Subscriptions"
        blurb="The same charge, same rhythm. This is the list to go through and cancel from."
        rows={subscriptions}
      />
      <Section
        title="Monthly obligations"
        blurb="Recurring and not optional, but the amount moves. Insurance, utilities, the phone."
        rows={obligations}
      />
      {stopped.length > 0 && (
        <Section
          title="Stopped"
          blurb="Was recurring, has not been charged in a while. Either cancelled already, or about to be a surprise."
          rows={stopped}
        />
      )}
      {transfers.length > 0 && (
        <Section
          title="Payments and transfers"
          blurb="Money moving between our own accounts, or a card being paid off. Counted here and deliberately kept out of the monthly total, because it is the same money twice."
          rows={transfers}
        />
      )}

      <button
        type="button"
        onClick={() => setShowDismissed(!showDismissed)}
        className="self-start text-xs text-muted-foreground underline"
      >
        {showDismissed ? "Hide the ones marked not ours" : "Show the ones marked not ours"}
      </button>

      <p className="text-xs text-muted-foreground">
        Worked out from {board.txnCount.toLocaleString()} transactions
        {board.since && ` back to ${new Date(`${board.since}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
        . Nothing here is stored: a subscription cancelled last month drops off this list by itself.
      </p>
    </div>
  );
}

/**
 * The overhead, grouped.
 *
 * "Four and a half thousand a month" is a fact; "two and a half of that is the
 * unit and five hundred is software" is a decision. The groups are in a fixed
 * order rather than by size, because the list is read to find something to cut
 * and the things at the top are the things you cannot.
 */
function Overhead({ board }: { board: RecurringBoard }) {
  const { overhead } = board;
  if (overhead.groups.length === 0) return null;

  const unsorted = overhead.groups.find((group) => group.group === "other");

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">What it costs to keep the doors open</h2>
        <p className="text-xs text-muted-foreground">
          Worked out from the bank, not typed in. {money(overhead.monthly)} a month,{" "}
          {money(overhead.yearly)} a year.
          {overhead.variableShare > 0.2 &&
            ` About ${Math.round(overhead.variableShare * 100)}% of it is an average of bills that move, so treat it as a guide rather than a fixed figure.`}
        </p>
      </div>

      <ul className="divide-y divide-border">
        {overhead.groups.map((group) => (
          <li key={group.group} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{group.label}</span>
              <span className="text-sm font-semibold tabular-nums">{money(group.monthly)}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {group.lines.map((line) => `${line.label} ${money(line.monthly)}`).join(" · ")}
            </p>
          </li>
        ))}
      </ul>

      {/* The one thing that makes the breakdown wrong out of the box: a
          landlord's trading name says nothing about being rent. */}
      {unsorted && unsorted.lines.length > 0 && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {unsorted.lines.length} charge{unsorted.lines.length === 1 ? " is" : "s are"} still
          unsorted below. Put them in a group and the breakdown sharpens.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-3 py-3.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Section({ title, blurb, rows }: { title: string; blurb: string; rows: ChargeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row }: { row: ChargeRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const dismissed = Boolean(row.decision?.dismissedAt);
  const confirmed = Boolean(row.decision?.confirmedAt);

  function act(run: () => Promise<unknown>) {
    start(async () => {
      await run();
      router.refresh();
    });
  }

  return (
    <li className={cn("p-3", dismissed && "opacity-50")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{row.label}</span>
        <span className="text-xs text-muted-foreground">{CADENCE_LABEL[row.cadence]}</span>
        {row.dayOfMonth != null && (
          <span className="text-xs text-muted-foreground">around the {ordinal(row.dayOfMonth)}</span>
        )}
        {row.accountName && <span className="text-xs text-muted-foreground">{row.accountName}</span>}
        <span className="ml-auto text-sm font-semibold tabular-nums">{money(row.monthlyAmount)}/mo</span>
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {money(row.typicalAmount)} {row.cadence === "monthly" ? "a month" : CADENCE_LABEL[row.cadence].toLowerCase()},
        seen {row.hits} times, last on{" "}
        {new Date(`${row.lastSeen}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        {row.live && `, next around ${new Date(`${row.nextDue}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
        {/* Said out loud when the pattern is thin, so a wrong row reads as a
            guess rather than as a fact somebody should act on. */}
        {row.confidence < 0.6 && ". Worth checking, the pattern is not a strong one"}
      </p>

      {row.decision?.cancelWanted && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Marked to cancel
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => confirmCharge({ merchantKey: row.key, confirmed: !confirmed }))}
          className={cn(
            "inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-xs",
            confirmed ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
          )}
        >
          <Check className="h-3.5 w-3.5" />
          {confirmed ? "Ours" : "It's ours"}
        </button>

        {row.kind !== "transfer" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(() => markForCancelling({ merchantKey: row.key, wanted: !row.decision?.cancelWanted }))
            }
            className="min-h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
          >
            {row.decision?.cancelWanted ? "Keep it after all" : "Cancel this"}
          </button>
        )}

        {row.kind !== "transfer" && (
          <select
            value={row.decision?.group ?? ""}
            disabled={pending}
            onChange={(event) =>
              act(() =>
                setOverheadGroup({
                  merchantKey: row.key,
                  group: event.target.value || null,
                })
              )
            }
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label={`Which overhead group ${row.label} belongs to`}
          >
            <option value="">Group it…</option>
            {GROUP_ORDER.map((group) => (
              <option key={group} value={group}>
                {GROUP_LABEL[group]}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => dismissCharge({ merchantKey: row.key, dismissed: !dismissed }))}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline"
        >
          <X className="h-3 w-3" />
          {dismissed ? "Put it back" : "Not an overhead"}
        </button>
      </div>
    </li>
  );
}

function ordinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

export const KINDS: ChargeKind[] = ["subscription", "obligation", "transfer"];
export { KIND_LABEL };
