"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/inventory-value";
import { CADENCE_LABEL, KIND_LABEL, type ChargeKind } from "@/lib/recurring";
import { GROUP_LABEL, GROUP_NOTE, GROUP_ORDER } from "@/lib/overhead";
import {
  confirmCharge,
  dismissCharge,
  includeCharge,
  markForCancelling,
  setAmountBasis,
  setOverheadGroup,
} from "@/lib/actions/recurring-actions";
import type { ChargeRow, RecurringBoard } from "@/lib/data/recurring";
import type { MerchantSpend, SpendReview } from "@/lib/spend-review";

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

      <Reconciliation review={board.review} />

      <Overhead board={board} />

      <NotCounted uncounted={board.review.uncounted} months={board.review.months} />

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
            {GROUP_NOTE[group.group] && (
              <p className="text-[11px] text-muted-foreground">{GROUP_NOTE[group.group]}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {group.lines
                .map((line) => `${line.label} ${money(line.monthly)}${line.note ? ` (${line.note})` : ""}`)
                .join(" · ")}
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

/**
 * Every dollar that left, and which of them the overhead knows about.
 *
 * Forty thousand a month leaves these accounts and four and a half of it is
 * overhead. A screen showing only the four and a half invites the reading that
 * the rest does not exist, and the first question anybody sensible asks of an
 * overhead figure is "out of what".
 *
 * Most of the remainder is materials, crew and cards being settled, which is
 * correct. The part worth looking at is what is left after those, because that
 * is where a real monthly cost hides.
 */
function Reconciliation({ review }: { review: SpendReview }) {
  if (review.months <= 0) return null;
  const checkedShare =
    review.chargeCount > 0 ? Math.round((review.checkedCount / review.chargeCount) * 100) : 0;

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Where the money actually goes</h2>
        <p className="text-xs text-muted-foreground">
          {money(review.outPerMonth)} a month leaves these accounts, averaged over{" "}
          {review.months} months. This is what the overhead is a part of.
        </p>
      </div>

      <ul className="divide-y divide-border">
        <Split
          label="Overhead"
          value={review.overheadPerMonth}
          note="Rent, insurance, software, the phone. What goes out whether anybody works or not."
        />
        <Split
          label="Everything else"
          value={review.uncountedPerMonth}
          note="Materials, crew and one-offs. Job costs, not overhead — but worth a look for anything that belongs above."
        />
        <Split
          label="Cards and transfers"
          value={review.transfersPerMonth}
          note="The same money twice: spent once, and again when the card was settled. Deliberately not counted."
        />
        {review.dismissedPerMonth > 0 && (
          <Split
            label="Pushed out by hand"
            value={review.dismissedPerMonth}
            note="Marked not an overhead by somebody."
          />
        )}
      </ul>

      <div className="border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {review.checkedCount} of {review.chargeCount} charges checked off, covering{" "}
          {money(review.checkedAmount)} of the {money(review.overheadPerMonth)}. Open a charge to see
          the transactions behind it.
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${checkedShare}%` }} />
        </div>
      </div>
    </section>
  );
}

function Split({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{money(value)}/mo</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </li>
  );
}

/**
 * The biggest things no recurring charge speaks for.
 *
 * Almost all of it is materials and crew and should stay where it is. The
 * reason it is on screen is the exception: a vehicle lease billed twice in six
 * months at two different amounts is real, monthly, and will never look
 * regular enough to be found. One tap puts it in the overhead at what it
 * actually averages.
 */
function NotCounted({ uncounted, months }: { uncounted: MerchantSpend[]; months: number }) {
  const [open, setOpen] = useState(false);
  if (uncounted.length === 0) return null;

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="text-sm font-semibold">Not in the overhead</span>
        <span className="ml-auto text-xs text-muted-foreground">{uncounted.length} to look at</span>
      </button>

      {open && (
        <>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            The biggest spending nothing recurring accounts for. Most of it is materials and crew
            and belongs exactly where it is. Anything here that is really a monthly cost can be
            counted, and it will go in at what it averages over the {months} months of data.
          </p>
          <ul className="divide-y divide-border">
            {uncounted.map((merchant) => (
              <UncountedRow key={merchant.key} merchant={merchant} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function UncountedRow({ merchant }: { merchant: MerchantSpend }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-3">
      <span className="text-sm font-medium">{merchant.label}</span>
      <span className="text-xs text-muted-foreground">
        {merchant.hits} charge{merchant.hits === 1 ? "" : "s"}
      </span>
      <span className="text-xs text-muted-foreground">
        last {new Date(`${merchant.lastSeen}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </span>
      <span className="ml-auto text-sm font-semibold tabular-nums">{money(merchant.total)}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await includeCharge({ merchantKey: merchant.key, included: true });
            router.refresh();
          })
        }
        className="inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs hover:bg-accent sm:w-auto"
      >
        <Plus className="h-3.5 w-3.5" />
        Count it as overhead ({money(merchant.monthly)}/mo)
      </button>
    </li>
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
  const [open, setOpen] = useState(false);
  const dismissed = Boolean(row.decision?.dismissedAt);
  const confirmed = Boolean(row.decision?.confirmedAt);
  const basis = row.decision?.amountBasis ?? "median";
  const latest = row.history[0]?.amount ?? null;

  function act(run: () => Promise<unknown>) {
    start(async () => {
      await run();
      router.refresh();
    });
  }

  return (
    <li className={cn("p-3", dismissed && "opacity-50")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="-ml-1 inline-flex items-center gap-1 text-sm font-medium"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          {row.label}
        </button>
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

      {row.forced && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Counted because somebody said so, not because a rhythm was found. The monthly figure is
          what actually left, spread over the months it covers.
        </p>
      )}

      {row.decision?.cancelWanted && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Marked to cancel
        </p>
      )}

      {/* The transactions behind the figure. The point of being able to open a
          row at all: a median of a rent that stepped from 2,298 to 2,791 is a
          number the business has never paid, and that is invisible until the
          charges are listed underneath it. */}
      {open && (
        <div className="mt-2 rounded-md border border-border">
          {latest != null && row.history.length > 1 && row.kind !== "transfer" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2">
              <span className="text-xs text-muted-foreground">Price it from</span>
              <BasisButton
                label={`the middle of them, ${money(row.medianAmount)}`}
                active={basis === "median"}
                disabled={pending}
                onClick={() => act(() => setAmountBasis({ merchantKey: row.key, basis: "median" }))}
              />
              <BasisButton
                label={`the last one, ${money(latest)}`}
                active={basis === "latest"}
                disabled={pending}
                onClick={() => act(() => setAmountBasis({ merchantKey: row.key, basis: "latest" }))}
              />
            </div>
          )}

          <ul className="max-h-64 divide-y divide-border overflow-y-auto">
            {row.history.map((hit) => (
              <li key={hit.id} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {new Date(`${hit.postedOn}T12:00:00Z`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "2-digit",
                  })}
                </span>
                <span className="truncate text-xs text-muted-foreground">{hit.who}</span>
                <span className="shrink-0 text-xs font-medium tabular-nums">{money(hit.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
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

function BasisButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-md border px-2.5 text-xs",
        active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}

function ordinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

export const KINDS: ChargeKind[] = ["subscription", "obligation", "transfer"];
export { KIND_LABEL };
