import { serverEnv } from "@/lib/env";

/**
 * Minimal Plaid REST client (no SDK dependency). Only the four calls the
 * bank feed needs: create a Link token, exchange the public token, list
 * accounts and pull transactions with /transactions/sync.
 *
 * Plaid's sign convention is the opposite of ours: a positive Plaid amount
 * is money leaving the account. `toOurAmount` flips it.
 */

function baseUrl() {
  return serverEnv.plaidEnv === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: serverEnv.plaidClientId, secret: serverEnv.plaidSecret, ...body }),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as T & { error_message?: string; error_code?: string };
  if (!response.ok) {
    throw new Error(`Plaid ${path} failed: ${json.error_code ?? response.status} ${json.error_message ?? ""}`.trim());
  }
  return json;
}

export async function createLinkToken(userId: string): Promise<string> {
  const res = await plaidPost<{ link_token: string }>("/link/token/create", {
    client_name: "Field Estimator Books",
    user: { client_user_id: userId },
    products: ["transactions"],
    transactions: { days_requested: 730 },
    country_codes: ["US"],
    language: "en",
  });
  return res.link_token;
}

export async function exchangePublicToken(publicToken: string) {
  return plaidPost<{ access_token: string; item_id: string }>("/item/public_token/exchange", {
    public_token: publicToken,
  });
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
}

export async function getAccounts(accessToken: string) {
  return plaidPost<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken });
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
}

interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

/** Pull every change since `cursor`. Restarts if Plaid says the data moved mid-pagination. */
export async function syncTransactions(accessToken: string, cursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let next = cursor;
    try {
      for (let page = 0; page < 50; page++) {
        const res = await plaidPost<SyncPage>("/transactions/sync", {
          access_token: accessToken,
          count: 500,
          ...(next ? { cursor: next } : {}),
        });
        added.push(...res.added);
        modified.push(...res.modified);
        removed.push(...res.removed.map((r) => r.transaction_id));
        next = res.next_cursor;
        if (!res.has_more) break;
      }
      return { added, modified, removed, nextCursor: next };
    } catch (error) {
      if (error instanceof Error && error.message.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")) continue;
      throw error;
    }
  }
  throw new Error("Plaid transactions kept changing during sync; try again in a minute.");
}

/** Revoke the access token at Plaid (stops billing and data access). */
export async function removeItem(accessToken: string) {
  await plaidPost("/item/remove", { access_token: accessToken });
}

export function toOurAmount(plaidAmount: number) {
  return Math.round(-plaidAmount * 100) / 100;
}

export function accountKind(type: string, subtype: string | null): "checking" | "savings" | "credit_card" | "other" {
  if (type === "credit") return "credit_card";
  if (subtype === "checking") return "checking";
  if (subtype === "savings") return "savings";
  return "other";
}
