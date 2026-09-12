import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { overheadFrom, type OverheadBreakdown, type OverheadGroup } from "@/lib/overhead";
import {
  detectRecurring,
  isLive,
  monthlyTotals,
  nextDueOn,
  onLatestAmount,
  type AmountBasis,
  type ChargeKind,
  type MonthlyTotals,
  merchantKey as merchantKeyOf,
  type RecurringCharge,
  type Txn,
} from "@/lib/recurring";
import {
  chargeFromSpending,
  monthsCovered,
  reviewSpend,
  type Bucket,
  type Spent,
  type SpendReview,
} from "@/lib/spend-review";

/**
 * What goes out every month, worked out from the transactions themselves.
 *
 * The overhead this business prices against was typed in from memory and is
 * round numbers. Six months of real card and bank rows have been sitting in a
 * table nobody reads, and they know the answer to the penny.
 *
 * The charges are derived every time rather than saved. A subscription
 * cancelled in March drops off by itself, which a stored list would not do --
 * and a stale list of subscriptions is worse than none, because it gets
 * trusted.
 */

export interface Decision {
  label: string | null;
  kind: ChargeKind | null;
  confirmedAt: string | null;
  dismissedAt: string | null;
  cancelWanted: boolean;
  note: string | null;
  group: OverheadGroup | null;
  /** Counts even though no rhythm was found. A real cost billed irregularly. */
  includedAt: string | null;
  /** Which amount to price from. Null means the median of every charge. */
  amountBasis: AmountBasis | null;
}

/** One of the charges behind a row, for checking the figure by eye. */
export interface ChargeHit {
  id: string;
  postedOn: string;
  amount: number;
  /** What the bank actually printed, which is often not the tidied label. */
  who: string;
}

export interface ChargeRow extends RecurringCharge {
  decision: Decision | null;
  live: boolean;
  nextDue: string;
  /** The account it lands on, as somebody would say it. */
  accountName: string | null;
  /** What the bank filed it under, for working out which bucket it is. */
  category: string | null;
  /**
   * Every charge behind the figure, newest first.
   *
   * The point of the screen. A monthly amount is a median of these, and a
   * median of a rent that stepped up from 2,298 to 2,791 is a number the
   * business has never paid -- which is invisible until the list is on screen
   * beside it.
   */
  history: ChargeHit[];
  /** Pulled in by hand rather than detected. */
  forced: boolean;
  /**
   * What the middle of its charges comes to, whatever it is being priced from.
   *
   * Kept beside the amount in use so the choice between the two can be offered
   * with both numbers on the button, rather than asking somebody to pick
   * "median" or "latest" in the abstract.
   */
  medianAmount: number;
}

export interface RecurringBoard {
  charges: ChargeRow[];
  totals: MonthlyTotals;
  /** The overhead, grouped, from what survived a person looking at it. */
  overhead: OverheadBreakdown;
  /**
   * Every dollar that left, and which of them the overhead knows about.
   *
   * Without it the screen shows four and a half thousand a month and invites
   * the reading that the other thirty-five does not exist.
   */
  review: SpendReview;
  /** Transactions read, and how far back they go. */
  txnCount: number;
  since: string | null;
}

const LOOKBACK_DAYS = 400;

export const getRecurringBoard = cache(async function getRecurringBoard(): Promise<RecurringBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
  const sinceDay = since.toISOString().slice(0, 10);

  const [{ data: txnRows }, { data: accounts }, { data: decisions }] = await Promise.all([
      supabase
        .from("bank_transactions")
        .select("id, name, merchant, amount, posted_on, account_id, category")
        .eq("organization_id", organizationId)
        .gt("amount", 0)
        .eq("pending", false)
        .gte("posted_on", sinceDay)
        .order("posted_on"),
      supabase.from("bank_accounts").select("id, name, mask").eq("organization_id", organizationId),
      supabase
        .from("recurring_decisions")
        .select(
          "merchant_key, label, kind, confirmed_at, dismissed_at, cancel_wanted, note, overhead_group, included_at, amount_basis"
        )
        .eq("organization_id", organizationId),
    ]);

  const txns: Txn[] = (txnRows ?? []).map((row) => ({
    id: row.id,
    who: (row.merchant ?? "").trim() || row.name || "Unknown",
    amount: Number(row.amount) || 0,
    postedOn: row.posted_on,
    accountId: row.account_id,
    category: row.category,
  }));

  // Plaid's own account id, not our row id, is what a transaction carries.
  const nameOf = new Map(
    (accounts ?? []).map((account) => [
      account.id,
      `${account.name}${account.mask ? ` ••${account.mask}` : ""}`,
    ])
  );

  const decisionOf = new Map<string, Decision>(
    (decisions ?? []).map((row) => [
      row.merchant_key,
      {
        label: row.label,
        kind: (row.kind as ChargeKind | null) ?? null,
        confirmedAt: row.confirmed_at,
        dismissedAt: row.dismissed_at,
        cancelWanted: row.cancel_wanted ?? false,
        note: row.note,
        group: (row.overhead_group as OverheadGroup | null) ?? null,
        includedAt: row.included_at ?? null,
        amountBasis: (row.amount_basis as AmountBasis | null) ?? null,
      },
    ])
  );

  // The bank's own category, kept against the merchant so the overhead can be
  // grouped without going back to the rows. The spending is kept beside it, so
  // a row can show the charges behind its own figure.
  const categoryOf = new Map<string, string | null>();
  const spentBy = new Map<string, Spent[]>();
  const spent: Spent[] = [];
  for (const txn of txns) {
    const key = merchantKeyOf(txn.who);
    if (!categoryOf.has(key) && txn.category) categoryOf.set(key, txn.category);
    const line: Spent = {
      id: txn.id,
      key,
      who: txn.who,
      amount: txn.amount,
      postedOn: txn.postedOn,
      category: txn.category,
    };
    spent.push(line);
    const list = spentBy.get(key) ?? [];
    list.push(line);
    spentBy.set(key, list);
  }

  const months = monthsCovered(txns.map((txn) => txn.postedOn));

  /** Newest first: the last charge is the one somebody is checking against. */
  function historyFor(key: string): ChargeHit[] {
    return [...(spentBy.get(key) ?? [])]
      .sort((a, b) => b.postedOn.localeCompare(a.postedOn))
      .map((line) => ({ id: line.id, postedOn: line.postedOn, amount: line.amount, who: line.who }));
  }

  const found = detectRecurring(txns);

  // Charges nobody detected, that somebody said count anyway. A vehicle lease
  // billed twice at two different amounts is not a rhythm and is still a
  // lease, and there was no way to say so.
  const detectedKeys = new Set(found.map((charge) => charge.key));
  const forcedIn: RecurringCharge[] = [];
  for (const [key, decision] of decisionOf) {
    if (!decision.includedAt || detectedKeys.has(key)) continue;
    const charge = chargeFromSpending(key, spentBy.get(key) ?? [], months);
    if (charge) forcedIn.push(charge);
  }

  const charges: ChargeRow[] = [...found, ...forcedIn].map((charge) => {
    const decision = decisionOf.get(charge.key) ?? null;
    const kind = decision?.kind ?? charge.kind;
    const history = historyFor(charge.key);
    // Restated on the last amount when somebody has said the old one is gone.
    // The rent stepped up and the median of before and after is a figure the
    // business has never paid.
    const stated =
      decision?.amountBasis === "latest" && history.length > 0
        ? onLatestAmount(charge, history[0].amount)
        : charge;
    return {
      ...stated,
      kind,
      label: decision?.label?.trim() || charge.label,
      decision,
      live: isLive(charge),
      nextDue: nextDueOn(charge),
      accountName: charge.accountId ? nameOf.get(charge.accountId) ?? null : null,
      category: categoryOf.get(charge.key) ?? null,
      history,
      forced: !detectedKeys.has(charge.key),
      medianAmount: charge.typicalAmount,
    };
  });

  // Dismissed ones are off the total but stay on the screen, so a decision
  // somebody made can be seen and undone rather than vanishing.
  const counted = charges.filter((charge) => !charge.decision?.dismissedAt && charge.live);

  const overhead = overheadFrom(
    charges.map((charge) => ({
      ...charge,
      dismissed: Boolean(charge.decision?.dismissedAt),
      live: charge.live,
      group: charge.decision?.group ?? null,
      note: charge.decision?.note ?? null,
    }))
  );

  // Which bucket each merchant's spending falls in, for the reconciliation.
  // Anything no charge speaks for is uncounted by definition -- materials,
  // crew, and the occasional real cost nobody has noticed yet.
  const bucketOf = new Map<string, Bucket>();
  for (const charge of charges) {
    bucketOf.set(
      charge.key,
      charge.decision?.dismissedAt
        ? "dismissed"
        : charge.kind === "transfer"
          ? "transfer"
          : charge.live
            ? "overhead"
            : "uncounted"
    );
  }

  const inOverhead = charges.filter(
    (charge) => !charge.decision?.dismissedAt && charge.live && charge.kind !== "transfer"
  );
  const ticked = inOverhead.filter((charge) => charge.decision?.confirmedAt);

  return {
    charges,
    totals: monthlyTotals(counted),
    review: reviewSpend(spent, (key) => bucketOf.get(key) ?? "uncounted", {
      checkedCount: ticked.length,
      chargeCount: inOverhead.length,
      checkedAmount: Math.round(ticked.reduce((sum, c) => sum + c.monthlyAmount, 0) * 100) / 100,
      overheadAmount: overhead.monthly,
    }),
    overhead,
    txnCount: txns.length,
    since: txns[0]?.postedOn ?? null,
  };
});
