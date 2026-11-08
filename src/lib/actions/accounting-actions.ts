"use server";

import { revalidatePath } from "next/cache";

import { suggestCategories } from "@/lib/accounting/ai-categorize";
import { csvExternalIds, parseStatementCsv } from "@/lib/accounting/csv";
import { createLinkToken, exchangePublicToken, removeItem } from "@/lib/accounting/plaid";
import { merchantKey } from "@/lib/accounting/rules";
import { insertTransactions, reapplyRules, syncBankConnection } from "@/lib/accounting/service";
import { isCategoryKey } from "@/lib/accounting/schedule-c";
import { yearRange } from "@/lib/data/accounting";
import { isPlaidConfigured, serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
  message?: string;
}

function revalidateAccounting() {
  revalidatePath("/accounting", "layout");
}

const MAX_CSV_BYTES = 4 * 1024 * 1024;

export async function importStatementCsv(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_CSV_BYTES) return { error: "That file is over 4 MB. Split it into smaller date ranges." };

  let accountId = String(formData.get("account_id") ?? "");
  if (!accountId || accountId === "new") {
    const name = String(formData.get("new_account_name") ?? "").trim();
    if (!name) return { error: "Name the account (e.g. Chase Business Checking)." };
    const kind = String(formData.get("new_account_kind") ?? "checking");
    const { data, error } = await supabase
      .from("accounting_accounts")
      .insert({ name, kind: kind as "checking", source: "csv" })
      .select("id")
      .single();
    if (error) throw error;
    accountId = data.id;
  }

  let parsed;
  try {
    parsed = parseStatementCsv(await file.text(), { purchasesArePositive: formData.get("purchases_positive") === "on" });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't read that CSV." };
  }
  if (parsed.rows.length === 0) return { error: "No transactions found in that file." };

  const ids = csvExternalIds(accountId, parsed.rows);
  const { inserted } = await insertTransactions(
    supabase,
    accountId,
    parsed.rows.map((row, i) => ({ externalId: ids[i], postedOn: row.postedOn, description: row.description, amount: row.amount }))
  );
  await supabase.from("accounting_imports").insert({
    account_id: accountId,
    filename: file.name,
    row_count: parsed.rows.length,
    inserted_count: inserted,
  });

  revalidateAccounting();
  const dupes = parsed.rows.length - inserted;
  return {
    message:
      `Imported ${inserted} new transactions` +
      (dupes ? `, skipped ${dupes} already imported` : "") +
      (parsed.skipped.length ? `, ignored ${parsed.skipped.length} unreadable rows` : "") +
      `. Columns used: ${parsed.columns.date} / ${parsed.columns.description} / ${parsed.columns.amount}.`,
  };
}

export async function updateTransactionCategory(
  id: string,
  category: string,
  remember: boolean
): Promise<ActionResult> {
  if (!isCategoryKey(category)) return { error: "Unknown category." };
  const supabase = await createClient();

  const { data: tx, error } = await supabase
    .from("accounting_transactions")
    .update({
      category,
      category_source: "manual",
      confidence: 1,
      needs_review: category === "uncategorized",
      categorization_reason: "Set by hand",
    })
    .eq("id", id)
    .select("description, merchant_name")
    .single();
  if (error) throw error;

  let message: string | undefined;
  if (remember && category !== "uncategorized") {
    const key = merchantKey(tx.merchant_name || tx.description);
    if (key.length >= 3) {
      const { error: ruleError } = await supabase
        .from("accounting_rules")
        .upsert({ match_text: key, category }, { onConflict: "match_text" });
      if (ruleError) throw ruleError;
      const { updated } = await reapplyRules(supabase);
      message = `Saved rule "${key}"${updated ? ` and updated ${updated} other transactions` : ""}.`;
    }
  }

  revalidateAccounting();
  return { message };
}

export async function updateTransactionNote(id: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounting_transactions")
    .update({ notes: notes.trim() || null })
    .eq("id", id);
  if (error) throw error;
  revalidateAccounting();
  return {};
}

/** Accept the current (rule or Claude) category on these transactions. */
export async function approveTransactions(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("accounting_transactions")
      .update({ needs_review: false })
      .in("id", ids.slice(i, i + 200))
      .neq("category", "uncategorized");
    if (error) throw error;
  }
  revalidateAccounting();
  return { message: "Approved. Anything still marked Needs review has to be picked by hand." };
}

export async function deleteRule(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("accounting_rules").delete().eq("id", id);
  if (error) throw error;
  revalidateAccounting();
  return {};
}

/**
 * Ask Claude to suggest categories for up to 150 transactions still waiting
 * on review that weren't set by hand. Suggestions stay flagged for review.
 */
export async function suggestWithClaude(year: number): Promise<ActionResult> {
  if (!serverEnv.anthropicApiKey) return { error: "Set ANTHROPIC_API_KEY to use Claude suggestions." };
  const supabase = await createClient();
  const { from, to } = yearRange(year);
  const { data, error } = await supabase
    .from("accounting_transactions")
    .select("id, description, merchant_name, amount, posted_on")
    .eq("needs_review", true)
    .in("category_source", ["default", "rule"])
    .gte("posted_on", from)
    .lte("posted_on", to)
    .order("posted_on")
    .limit(150);
  if (error) throw error;
  if (!data?.length) return { message: "Nothing left for Claude to look at." };

  let suggestions;
  try {
    suggestions = await suggestCategories(data.map((t) => ({ ...t, amount: Number(t.amount) })));
  } catch (err) {
    console.error("[accounting] Claude categorization failed", err);
    return { error: "Claude couldn't categorize right now. Try again in a minute." };
  }

  for (const s of suggestions) {
    await supabase
      .from("accounting_transactions")
      .update({
        category: s.category,
        category_source: "ai",
        confidence: Math.round(s.confidence * 100) / 100,
        categorization_reason: `Claude: ${s.reason}`,
        needs_review: true,
      })
      .eq("id", s.id);
  }
  revalidateAccounting();
  return { message: `Claude suggested categories for ${suggestions.length} transactions. Review and approve them below.` };
}

function num(formData: FormData, name: string, fallback: number, { percent = false } = {}) {
  const raw = String(formData.get(name) ?? "").replace(/[$,%\s]/g, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return percent ? n / 100 : n;
}

export async function saveYearSettings(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const taxYear = Number(formData.get("tax_year"));
  if (!Number.isInteger(taxYear)) return { error: "Missing tax year." };
  const treatment = String(formData.get("plant_treatment") ?? "");

  const { error } = await supabase.from("accounting_year_settings").upsert(
    {
      tax_year: taxYear,
      beginning_inventory: num(formData, "beginning_inventory", 0),
      ending_inventory: num(formData, "ending_inventory", 0),
      sales_tax_rate: Math.min(0.2, num(formData, "sales_tax_rate", 7, { percent: true })),
      sales_tax_paid_on_materials: formData.get("sales_tax_paid_on_materials") === "on",
      plant_markup: Math.max(1, num(formData, "plant_markup", 2)),
      federal_marginal_rate: Math.min(0.37, num(formData, "federal_marginal_rate", 22, { percent: true })),
      state_income_rate: Math.min(0.15, num(formData, "state_income_rate", 5, { percent: true })),
      qbi_deduction: formData.get("qbi_deduction") === "on",
      plant_treatment: treatment === "sell" || treatment === "install" ? treatment : null,
    },
    { onConflict: "tax_year" }
  );
  if (error) throw error;
  revalidateAccounting();
  return { message: "Saved." };
}

// ---------- Plaid bank feed ----------

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function createPlaidLinkToken(): Promise<{ linkToken?: string; error?: string }> {
  if (!isPlaidConfigured()) return { error: "Set PLAID_CLIENT_ID, PLAID_SECRET and SUPABASE_SERVICE_ROLE_KEY first." };
  const user = await requireUser();
  if (!user) return { error: "Sign in before connecting a bank." };
  try {
    return { linkToken: await createLinkToken(user.id) };
  } catch (err) {
    console.error("[accounting] Plaid link token failed", err);
    return { error: "Couldn't start the bank connection. Check the Plaid keys." };
  }
}

export async function completePlaidLink(publicToken: string, institutionName: string | null): Promise<ActionResult> {
  if (!isPlaidConfigured()) return { error: "Plaid isn't configured." };
  const user = await requireUser();
  if (!user) return { error: "Sign in before connecting a bank." };

  const admin = createAdminClient();
  const { access_token, item_id } = await exchangePublicToken(publicToken);

  const { data: connection, error } = await admin
    .from("bank_connections")
    .upsert({ item_id, institution_name: institutionName, status: "active" }, { onConflict: "item_id" })
    .select("id")
    .single();
  if (error) throw error;
  const { error: secretError } = await admin
    .from("bank_connection_secrets")
    .upsert({ connection_id: connection.id, access_token, sync_cursor: null }, { onConflict: "connection_id" });
  if (secretError) throw secretError;

  let message = `Connected ${institutionName ?? "your bank"}.`;
  try {
    const { inserted } = await syncBankConnection(admin, connection.id);
    message += ` Pulled ${inserted} transactions.`;
  } catch (err) {
    console.error("[accounting] first Plaid sync failed", err);
    message += " The bank is still preparing your history; it will sync on the next run (or press Sync now in a few minutes).";
  }
  revalidateAccounting();
  return { message };
}

export async function syncBankNow(connectionId: string): Promise<ActionResult> {
  if (!isPlaidConfigured()) return { error: "Plaid isn't configured." };
  const user = await requireUser();
  if (!user) return { error: "Sign in to sync." };
  try {
    const { inserted, removed } = await syncBankConnection(createAdminClient(), connectionId);
    revalidateAccounting();
    return { message: `Synced: ${inserted} new${removed ? `, ${removed} removed by the bank` : ""}.` };
  } catch (err) {
    revalidateAccounting();
    return { error: err instanceof Error ? err.message : "Sync failed." };
  }
}

export async function disconnectBank(connectionId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { error: "Sign in first." };
  const admin = createAdminClient();
  const { data: secret } = await admin
    .from("bank_connection_secrets")
    .select("access_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (secret && isPlaidConfigured()) {
    try {
      await removeItem(secret.access_token);
    } catch (err) {
      console.error("[accounting] Plaid item/remove failed", err);
    }
  }
  // Keep the transactions (they're your books); drop the token.
  await admin.from("bank_connection_secrets").delete().eq("connection_id", connectionId);
  await admin.from("bank_connections").update({ status: "disconnected" }).eq("id", connectionId);
  revalidateAccounting();
  return { message: "Disconnected. Already-imported transactions are kept." };
}
