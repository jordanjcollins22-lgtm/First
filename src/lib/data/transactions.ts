import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { detectRecurring, merchantKey, type Txn } from "@/lib/recurring";
import {
  applyFilters,
  byMonth,
  categoryLabel,
  spendByCategory,
  spendByMerchant,
  totalsOf,
  type CategoryTotal,
  type Filters,
  type MerchantTotal,
  type MonthGroup,
  type Totals,
  type Transaction,
} from "@/lib/transactions";

/**
 * Every transaction the banks and cards have sent.
 *
 * Read whole and filtered in memory rather than narrowed in SQL. There are
 * hundreds of these, not millions, and doing it here means the totals, the
 * monthly subtotals and the "which of these recur" mark are all worked out
 * over the same set — which is the thing that goes wrong when a page filters
 * in one place and counts in another.
 */

export interface TransactionBoard {
  rows: Transaction[];
  months: MonthGroup[];
  totals: Totals;
  categories: CategoryTotal[];
  merchants: MerchantTotal[];
  /** Everything, for the filter controls, whatever is filtered right now. */
  accounts: { id: string; name: string }[];
  allCategories: { value: string; label: string }[];
  /** How many there are in total, so a filtered count means something. */
  everything: number;
  earliest: string | null;
}

const LOOKBACK_DAYS = 730;

export async function getTransactionBoard(filters: Filters): Promise<TransactionBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  const [{ data: txnRows }, { data: accountRows }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, name, merchant, amount, posted_on, account_id, category, pending")
      .eq("organization_id", organizationId)
      .gte("posted_on", since.toISOString().slice(0, 10))
      .order("posted_on", { ascending: false })
      .limit(5000),
    supabase.from("bank_accounts").select("id, name, mask").eq("organization_id", organizationId),
  ]);

  const raw = txnRows ?? [];

  const accountName = new Map(
    (accountRows ?? []).map((account) => [
      account.id,
      `${account.name}${account.mask ? ` ••${account.mask}` : ""}`,
    ])
  );

  // Which merchants come back on a rhythm. Worked out from the same detector
  // the Subscriptions screen uses, so the two screens can never disagree about
  // what is recurring.
  const spending: Txn[] = raw
    .filter((row) => Number(row.amount) > 0 && !row.pending)
    .map((row) => ({
      id: row.id,
      who: (row.merchant ?? "").trim() || row.name || "Unknown",
      amount: Number(row.amount) || 0,
      postedOn: row.posted_on,
      accountId: row.account_id,
      category: row.category,
    }));
  const recurringKeys = new Set(detectRecurring(spending).map((charge) => charge.key));

  const rows: Transaction[] = raw.map((row) => {
    const who = (row.merchant ?? "").trim() || row.name || "Unknown";
    return {
      id: row.id,
      who,
      amount: Number(row.amount) || 0,
      postedOn: row.posted_on,
      accountId: row.account_id,
      accountName: row.account_id ? accountName.get(row.account_id) ?? null : null,
      category: row.category,
      pending: row.pending ?? false,
      recurring: Number(row.amount) > 0 && recurringKeys.has(merchantKey(who)),
    };
  });

  const filtered = applyFilters(rows, filters);

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.category && !seen.has(row.category)) seen.set(row.category, categoryLabel(row.category));
  }

  return {
    rows: filtered,
    months: byMonth(filtered),
    totals: totalsOf(filtered),
    categories: spendByCategory(filtered),
    merchants: spendByMerchant(filtered),
    accounts: Array.from(accountName.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    allCategories: Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    everything: rows.length,
    earliest: rows.length > 0 ? rows[rows.length - 1].postedOn : null,
  };
}
