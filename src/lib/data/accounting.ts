import type { ReportTransaction, YearSettings } from "@/lib/accounting/report";
import { getCategory, type CategoryKey } from "@/lib/accounting/schedule-c";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type AccountRow = Tables["accounting_accounts"]["Row"];
export type ConnectionRow = Tables["bank_connections"]["Row"];
export type TransactionRow = Tables["accounting_transactions"]["Row"] & {
  account: Pick<AccountRow, "id" | "name" | "mask"> | null;
};
export type RuleRow = Tables["accounting_rules"]["Row"];
export type YearSettingsRow = Tables["accounting_year_settings"]["Row"];

export function yearRange(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Default to last year until April 15, since that's the return being worked on. */
export function defaultTaxYear(now = new Date()) {
  const y = now.getFullYear();
  return now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() <= 15) ? y - 1 : y;
}

export function parseYear(raw: string | string[] | undefined) {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : defaultTaxYear();
}

export async function listAccounts(): Promise<AccountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounting_accounts").select("*").eq("active", true).order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listConnections(): Promise<ConnectionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .select("*")
    .neq("status", "disconnected")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function listRules(): Promise<RuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounting_rules").select("*").order("match_text");
  if (error) throw error;
  return data ?? [];
}

export interface TransactionFilter {
  year: number;
  view: "review" | "all";
  category?: string;
  q?: string;
  limit?: number;
}

export async function listTransactions(filter: TransactionFilter): Promise<TransactionRow[]> {
  const supabase = await createClient();
  const { from, to } = yearRange(filter.year);
  let query = supabase
    .from("accounting_transactions")
    .select("*, account:accounting_accounts(id, name, mask)")
    .gte("posted_on", from)
    .lte("posted_on", to)
    .order("posted_on", { ascending: false })
    .limit(filter.limit ?? 500);
  if (filter.view === "review") query = query.eq("needs_review", true);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.q) query = query.ilike("description", `%${filter.q.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as unknown as TransactionRow[];
}

/** Every transaction in the year (paged past Supabase's 1,000-row cap) for the report. */
export async function listYearTransactions(year: number): Promise<ReportTransaction[]> {
  const supabase = await createClient();
  const { from, to } = yearRange(year);
  const all: ReportTransaction[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("accounting_transactions")
      .select("id, posted_on, description, merchant_name, amount, category, needs_review")
      .gte("posted_on", from)
      .lte("posted_on", to)
      .order("posted_on")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const t of data ?? []) {
      all.push({
        id: t.id,
        posted_on: t.posted_on,
        description: t.merchant_name ? `${t.merchant_name} · ${t.description}` : t.description,
        amount: Number(t.amount),
        category: getCategory(t.category).key as CategoryKey,
        needs_review: t.needs_review,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return all;
}

const DEFAULT_SETTINGS = {
  beginning_inventory: 0,
  ending_inventory: 0,
  sales_tax_rate: 0.07,
  sales_tax_paid_on_materials: true,
  plant_markup: 2,
  federal_marginal_rate: 0.22,
  state_income_rate: 0.05,
  qbi_deduction: true,
  plant_treatment: null,
} as const;

function toSettings(year: number, row: Partial<YearSettingsRow> | null, prior: Partial<YearSettingsRow> | null): YearSettings {
  const r = { ...DEFAULT_SETTINGS, ...(row ?? {}) };
  return {
    taxYear: year,
    // If this year hasn't been saved yet, carry last year's ending count forward.
    beginningInventory: row ? Number(r.beginning_inventory) : Number(prior?.ending_inventory ?? 0),
    endingInventory: Number(r.ending_inventory),
    salesTaxRate: Number(r.sales_tax_rate),
    salesTaxPaidOnMaterials: Boolean(r.sales_tax_paid_on_materials),
    plantMarkup: Number(r.plant_markup),
    rates: {
      federalMarginalRate: Number(r.federal_marginal_rate),
      stateIncomeRate: Number(r.state_income_rate),
      qbiDeduction: Boolean(r.qbi_deduction),
    },
    plantTreatment: (r.plant_treatment as YearSettings["plantTreatment"]) ?? null,
    priorYearEndingInventory: prior ? Number(prior.ending_inventory) : null,
    priorYearTreatment: (prior?.plant_treatment as YearSettings["priorYearTreatment"]) ?? null,
  };
}

export async function getYearSettings(year: number): Promise<YearSettings & { saved: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounting_year_settings")
    .select("*")
    .in("tax_year", [year, year - 1]);
  if (error) throw error;
  const row = data?.find((r) => r.tax_year === year) ?? null;
  const prior = data?.find((r) => r.tax_year === year - 1) ?? null;
  return { ...toSettings(year, row, prior), saved: Boolean(row) };
}

export async function countNeedsReview(year: number) {
  const supabase = await createClient();
  const { from, to } = yearRange(year);
  const { count, error } = await supabase
    .from("accounting_transactions")
    .select("id", { count: "exact", head: true })
    .eq("needs_review", true)
    .gte("posted_on", from)
    .lte("posted_on", to);
  if (error) throw error;
  return count ?? 0;
}
