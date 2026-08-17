/**
 * The vocabulary of the money ledger.
 *
 * Categories live here rather than being typed into a dropdown so the labels,
 * the direction each one belongs to, and the database's check constraint can't
 * drift apart. `categoriesFor` is what the form uses, which means an income
 * category can never be offered for an expense.
 */

import type {
  LedgerCategory,
  LedgerDirection,
  LedgerEntry,
  LedgerExpenseCategory,
  LedgerIncomeCategory,
} from "@/types/domain";

export const INCOME_CATEGORIES: { value: LedgerIncomeCategory; label: string }[] = [
  { value: "job_payment", label: "Job payment" },
  { value: "deposit", label: "Deposit" },
  { value: "other_income", label: "Other income" },
];

export const EXPENSE_CATEGORIES: { value: LedgerExpenseCategory; label: string }[] = [
  { value: "materials", label: "Materials" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "fuel", label: "Fuel" },
  { value: "equipment", label: "Equipment" },
  { value: "permit", label: "Permit / fees" },
  { value: "other_expense", label: "Other expense" },
];

export const PAYMENT_METHODS = ["cash", "check", "transfer", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The categories valid for one direction — the only list a form should offer. */
export function categoriesFor(direction: LedgerDirection): { value: LedgerCategory; label: string }[] {
  return direction === "in" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

const LABELS = new Map<string, string>(
  [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].map((c) => [c.value, c.label])
);

export function categoryLabel(category: string): string {
  return LABELS.get(category) ?? category;
}

/** Whether a category may be filed under a direction. Mirrors the database
 * constraint, so a bad pairing is caught before the round trip. */
export function isValidPairing(direction: LedgerDirection, category: string): boolean {
  return categoriesFor(direction).some((c) => c.value === category);
}

export interface LedgerTotals {
  in: number;
  out: number;
  net: number;
  byCategory: { category: LedgerCategory; label: string; direction: LedgerDirection; total: number }[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Adds the ledger up.
 *
 * Categories with nothing in them are left out entirely — a breakdown listing
 * six zeroes buries the two lines that matter.
 */
export function totalLedger(entries: Pick<LedgerEntry, "direction" | "category" | "amount">[]): LedgerTotals {
  let moneyIn = 0;
  let moneyOut = 0;
  const totals = new Map<LedgerCategory, number>();

  for (const entry of entries) {
    const amount = Number(entry.amount) || 0;
    if (entry.direction === "in") moneyIn += amount;
    else moneyOut += amount;
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + amount);
  }

  const byCategory = [...totals.entries()]
    .map(([category, total]) => ({
      category,
      label: categoryLabel(category),
      direction: (isValidPairing("in", category) ? "in" : "out") as LedgerDirection,
      total: round(total),
    }))
    .sort((a, b) => b.total - a.total);

  return { in: round(moneyIn), out: round(moneyOut), net: round(moneyIn - moneyOut), byCategory };
}
