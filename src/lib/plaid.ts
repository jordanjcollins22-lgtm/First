import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

import { env, isPlaidConfigured } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The bank, through Plaid.
 *
 * Plaid is how an app reads a bank account in the US: the business logs in
 * to FNB (or any other bank) inside Plaid's own window, Plaid hands back a
 * token, and with it the app reads balances and transactions from then
 * on. This is the reading: a link's accounts refreshed and its transactions
 * brought up to date from where the last read stopped, kept as ordinary
 * rows for the pulse to count. Nothing here decides anything.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface BankLinkRow {
  id: string;
  organization_id: string;
  item_id: string;
  access_token: string;
  institution_id: string | null;
  institution_name: string | null;
  cursor: string | null;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
}

export function plaidClient(): PlaidApi {
  if (!isPlaidConfigured) throw new Error("PLAID_CLIENT_ID and PLAID_SECRET are not set on the server.");
  const basePath = env.plaidEnv === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: { headers: { "PLAID-CLIENT-ID": env.plaidClientId, "PLAID-SECRET": env.plaidSecret } },
    })
  );
}

/** A token for Plaid's window; with an access token, the window re-does a login that has lapsed. */
export async function createLinkToken(input: { userId: string; orgName: string; webhookUrl: string | null; accessToken?: string }): Promise<string> {
  const plaid = plaidClient();
  const { data } = await plaid.linkTokenCreate({
    user: { client_user_id: input.userId },
    client_name: input.orgName,
    language: "en",
    country_codes: [CountryCode.Us],
    ...(input.accessToken ? { access_token: input.accessToken } : { products: [Products.Transactions] }),
    ...(input.webhookUrl ? { webhook: input.webhookUrl } : {}),
    transactions: { days_requested: 180 },
  });
  return data.link_token;
}

/** Plaid's short-lived public token, turned into the token the app keeps. */
export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const plaid = plaidClient();
  const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: data.access_token, itemId: data.item_id };
}

export async function removeItem(accessToken: string): Promise<void> {
  const plaid = plaidClient();
  await plaid.itemRemove({ access_token: accessToken });
}

/** Whether the accounts of a kind are the business's cash. */
export function countsAsCash(type: string | null | undefined): boolean {
  return type === "depository";
}

function messageOf(err: unknown): { message: string; code: string | null } {
  const e = err as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
  const data = e?.response?.data;
  return { message: data?.error_message ?? e?.message ?? String(err), code: data?.error_code ?? null };
}

/**
 * One link brought up to date: every account's balance now, and every
 * transaction since the last read. A login that has lapsed is marked so
 * the office is asked to redo it rather than the read failing quietly.
 */
export async function syncLink(admin: Admin, link: BankLinkRow): Promise<{ accounts: number; added: number; modified: number; removed: number }> {
  const plaid = plaidClient();
  const stamp = new Date().toISOString();
  try {
    const { data: balances } = await plaid.accountsBalanceGet({ access_token: link.access_token });
    for (const a of balances.accounts) {
      const { data: existing } = await admin.from("bank_accounts").select("id").eq("account_id", a.account_id).maybeSingle();
      const row = {
        organization_id: link.organization_id,
        link_id: link.id,
        account_id: a.account_id,
        name: a.name,
        official_name: a.official_name ?? null,
        mask: a.mask ?? null,
        type: String(a.type),
        subtype: a.subtype ? String(a.subtype) : null,
        current_balance: a.balances.current,
        available_balance: a.balances.available,
        currency: a.balances.iso_currency_code ?? null,
        balance_at: stamp,
        updated_at: stamp,
      };
      const { error } = existing
        ? await admin.from("bank_accounts").update(row).eq("id", existing.id)
        : await admin.from("bank_accounts").insert({ ...row, include: countsAsCash(String(a.type)) });
      if (error) throw error;
    }

    let cursor = link.cursor ?? undefined;
    let added = 0;
    let modified = 0;
    let removed = 0;
    for (let page = 0; page < 50; page++) {
      const { data } = await plaid.transactionsSync({ access_token: link.access_token, cursor, count: 500 });
      const upserts = [...data.added, ...data.modified].map((t) => ({
        organization_id: link.organization_id,
        account_id: t.account_id,
        transaction_id: t.transaction_id,
        amount: t.amount,
        posted_on: t.date,
        name: t.name ?? null,
        merchant: t.merchant_name ?? null,
        category: t.personal_finance_category?.primary ?? null,
        pending: Boolean(t.pending),
        updated_at: stamp,
      }));
      if (upserts.length > 0) {
        const { error } = await admin.from("bank_transactions").upsert(upserts, { onConflict: "transaction_id" });
        if (error) throw error;
      }
      if (data.removed.length > 0) {
        const { error } = await admin
          .from("bank_transactions")
          .delete()
          .in(
            "transaction_id",
            data.removed.map((r) => r.transaction_id).filter((id): id is string => Boolean(id))
          );
        if (error) throw error;
      }
      added += data.added.length;
      modified += data.modified.length;
      removed += data.removed.length;
      cursor = data.next_cursor;
      if (!data.has_more) break;
    }

    const { error } = await admin
      .from("bank_links")
      .update({ cursor: cursor ?? null, status: "ok", last_error: null, last_synced_at: stamp, updated_at: stamp })
      .eq("id", link.id);
    if (error) throw error;
    return { accounts: balances.accounts.length, added, modified, removed };
  } catch (err) {
    const { message, code } = messageOf(err);
    const status = code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT" ? "needs_relink" : "error";
    await admin.from("bank_links").update({ status, last_error: message, updated_at: stamp }).eq("id", link.id);
    throw new Error(message);
  }
}

/** Every link of an organisation brought up to date; a failed one is noted and the rest carry on. */
export async function syncOrganization(admin: Admin, organizationId: string): Promise<{ links: number; failed: string[] }> {
  const { data: links, error } = await admin.from("bank_links").select("*").eq("organization_id", organizationId);
  if (error) throw error;
  const failed: string[] = [];
  for (const link of (links ?? []) as BankLinkRow[]) {
    try {
      await syncLink(admin, link);
    } catch (err) {
      failed.push(`${link.institution_name ?? "bank"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if ((links ?? []).length > 0) {
    const { error: refreshError } = await admin.rpc("summary_refresh", { org: organizationId, the_key: "ops_pulse" });
    if (refreshError) console.error("[bank] pulse refresh after sync:", refreshError.message);
  }
  return { links: (links ?? []).length, failed };
}
