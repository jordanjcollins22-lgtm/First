import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  detectRecurring,
  isLive,
  monthlyTotals,
  nextDueOn,
  type ChargeKind,
  type MonthlyTotals,
  type RecurringCharge,
  type Txn,
} from "@/lib/recurring";

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
}

export interface ChargeRow extends RecurringCharge {
  decision: Decision | null;
  live: boolean;
  nextDue: string;
  /** The account it lands on, as somebody would say it. */
  accountName: string | null;
}

export interface RecurringBoard {
  charges: ChargeRow[];
  totals: MonthlyTotals;
  /** What the hand-typed overhead says, for comparison. */
  typedOverhead: number;
  /** Transactions read, and how far back they go. */
  txnCount: number;
  since: string | null;
}

const LOOKBACK_DAYS = 400;

export async function getRecurringBoard(): Promise<RecurringBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
  const sinceDay = since.toISOString().slice(0, 10);

  const [{ data: txnRows }, { data: accounts }, { data: decisions }, { data: overhead }] =
    await Promise.all([
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
        .select("merchant_key, label, kind, confirmed_at, dismissed_at, cancel_wanted, note")
        .eq("organization_id", organizationId),
      supabase.from("overhead_expenses").select("amount").eq("organization_id", organizationId),
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
      },
    ])
  );

  const found = detectRecurring(txns);
  const charges: ChargeRow[] = found.map((charge) => {
    const decision = decisionOf.get(charge.key) ?? null;
    const kind = decision?.kind ?? charge.kind;
    return {
      ...charge,
      kind,
      label: decision?.label?.trim() || charge.label,
      decision,
      live: isLive(charge),
      nextDue: nextDueOn(charge),
      accountName: charge.accountId ? nameOf.get(charge.accountId) ?? null : null,
    };
  });

  // Dismissed ones are off the total but stay on the screen, so a decision
  // somebody made can be seen and undone rather than vanishing.
  const counted = charges.filter((charge) => !charge.decision?.dismissedAt && charge.live);

  return {
    charges,
    totals: monthlyTotals(counted),
    typedOverhead:
      Math.round((overhead ?? []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100,
    txnCount: txns.length,
    since: txns[0]?.postedOn ?? null,
  };
}
