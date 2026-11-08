import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { accountKind, getAccounts, syncTransactions, toOurAmount } from "./plaid";
import { categorize, type UserRule } from "./rules";
import { isCategoryKey } from "./schedule-c";

type Client = SupabaseClient<Database>;

export interface NewTransaction {
  externalId: string;
  postedOn: string;
  description: string;
  merchantName?: string | null;
  amount: number;
}

export async function loadUserRules(supabase: Client): Promise<UserRule[]> {
  const { data, error } = await supabase.from("accounting_rules").select("match_text, category");
  if (error) throw error;
  return (data ?? []).filter((r) => isCategoryKey(r.category)) as UserRule[];
}

/**
 * Categorize and store transactions. Rows already imported (same account +
 * external id) are left alone, so a person's manual categories are never
 * overwritten by a re-import or re-sync.
 */
export async function insertTransactions(supabase: Client, accountId: string, rows: NewTransaction[]) {
  if (rows.length === 0) return { inserted: 0 };
  const rules = await loadUserRules(supabase);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((row) => {
      const text = row.merchantName ? `${row.merchantName} ${row.description}` : row.description;
      const result = categorize({ description: text, amount: row.amount }, rules);
      return {
        account_id: accountId,
        external_id: row.externalId,
        posted_on: row.postedOn,
        description: row.description,
        merchant_name: row.merchantName ?? null,
        amount: row.amount,
        category: result.category,
        category_source: result.source,
        confidence: result.confidence,
        needs_review: result.needsReview,
        categorization_reason: result.reason,
      };
    });
    const { data, error } = await supabase
      .from("accounting_transactions")
      .upsert(chunk, { onConflict: "account_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    inserted += data?.length ?? 0;
  }
  return { inserted };
}

/**
 * Re-run rules on everything a person hasn't touched. Called after a new
 * "always categorize X as Y" rule is saved so it applies to the backlog too.
 */
export async function reapplyRules(supabase: Client) {
  const rules = await loadUserRules(supabase);
  const { data, error } = await supabase
    .from("accounting_transactions")
    .select("id, description, merchant_name, amount, category")
    .neq("category_source", "manual")
    .limit(10_000);
  if (error) throw error;

  let updated = 0;
  for (const tx of data ?? []) {
    const text = tx.merchant_name ? `${tx.merchant_name} ${tx.description}` : tx.description;
    const result = categorize({ description: text, amount: Number(tx.amount) }, rules);
    if (result.source !== "user_rule" || result.category === tx.category) continue;
    const { error: updateError } = await supabase
      .from("accounting_transactions")
      .update({
        category: result.category,
        category_source: "user_rule",
        confidence: 1,
        needs_review: false,
        categorization_reason: result.reason,
      })
      .eq("id", tx.id);
    if (updateError) throw updateError;
    updated++;
  }
  return { updated };
}

/** Pull new/changed/removed transactions for one linked bank. Needs the service-role client. */
export async function syncBankConnection(admin: Client, connectionId: string) {
  const { data: secret, error: secretError } = await admin
    .from("bank_connection_secrets")
    .select("access_token, sync_cursor")
    .eq("connection_id", connectionId)
    .single();
  if (secretError) throw secretError;

  try {
    // Make sure every Plaid account has a row to attach transactions to.
    const { accounts } = await getAccounts(secret.access_token);
    const { data: connection } = await admin.from("bank_connections").select("institution_name").eq("id", connectionId).single();
    for (const account of accounts) {
      const { error } = await admin.from("accounting_accounts").upsert(
        {
          plaid_account_id: account.account_id,
          connection_id: connectionId,
          name: account.official_name || account.name,
          mask: account.mask,
          kind: accountKind(account.type, account.subtype),
          source: "plaid",
          institution: connection?.institution_name ?? null,
        },
        { onConflict: "plaid_account_id" }
      );
      if (error) throw error;
    }
    const { data: accountRows, error: accountsError } = await admin
      .from("accounting_accounts")
      .select("id, plaid_account_id")
      .eq("connection_id", connectionId);
    if (accountsError) throw accountsError;
    const accountIdByPlaid = new Map((accountRows ?? []).map((a) => [a.plaid_account_id, a.id]));

    const { added, modified, removed, nextCursor } = await syncTransactions(secret.access_token, secret.sync_cursor);

    // Pending charges change id when they post, so only store posted ones.
    let inserted = 0;
    const byAccount = new Map<string, NewTransaction[]>();
    for (const t of [...added, ...modified]) {
      if (t.pending) continue;
      const accountId = accountIdByPlaid.get(t.account_id);
      if (!accountId) continue;
      const list = byAccount.get(accountId) ?? [];
      list.push({
        externalId: `plaid:${t.transaction_id}`,
        postedOn: t.date,
        description: t.name,
        merchantName: t.merchant_name,
        amount: toOurAmount(t.amount),
      });
      byAccount.set(accountId, list);
    }
    for (const [accountId, rows] of byAccount) {
      inserted += (await insertTransactions(admin, accountId, rows)).inserted;
    }

    // A modified transaction keeps its category but picks up the bank's new
    // amount/date/description.
    for (const t of modified) {
      if (t.pending) continue;
      const accountId = accountIdByPlaid.get(t.account_id);
      if (!accountId) continue;
      await admin
        .from("accounting_transactions")
        .update({ posted_on: t.date, description: t.name, merchant_name: t.merchant_name, amount: toOurAmount(t.amount) })
        .eq("account_id", accountId)
        .eq("external_id", `plaid:${t.transaction_id}`);
    }

    if (removed.length > 0) {
      const { error } = await admin
        .from("accounting_transactions")
        .delete()
        .in("external_id", removed.map((id) => `plaid:${id}`));
      if (error) throw error;
    }

    await admin.from("bank_connection_secrets").update({ sync_cursor: nextCursor }).eq("connection_id", connectionId);
    await admin
      .from("bank_connections")
      .update({ status: "active", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", connectionId);

    return { inserted, removed: removed.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("bank_connections").update({ status: "error", last_error: message.slice(0, 500) }).eq("id", connectionId);
    throw error;
  }
}

export async function syncAllBankConnections(admin: Client) {
  const { data, error } = await admin.from("bank_connections").select("id").neq("status", "disconnected");
  if (error) throw error;
  const results: { id: string; inserted?: number; error?: string }[] = [];
  for (const { id } of data ?? []) {
    try {
      const r = await syncBankConnection(admin, id);
      results.push({ id, inserted: r.inserted });
    } catch (err) {
      results.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
