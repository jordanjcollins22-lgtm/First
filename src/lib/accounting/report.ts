import { directionMismatch, merchantKey, BUILT_IN_RULES } from "./rules";
import {
  type CategoryKey,
  type ScheduleCLineId,
  CATEGORIES,
  getCategory,
  LINE_BY_ID,
  SCHEDULE_C_LINES,
} from "./schedule-c";
import { estimateTaxes, type TaxEstimate, type TaxRates, yearConstants } from "./tax-estimate";

export interface ReportTransaction {
  id: string;
  posted_on: string;
  description: string;
  /** Positive = money in, negative = money out. */
  amount: number;
  category: CategoryKey;
  needs_review: boolean;
}

export type PlantTreatment = "sell" | "install";

export interface YearSettings {
  taxYear: number;
  /** Part III line 35. Must equal last year's ending inventory. */
  beginningInventory: number;
  /** Part III line 41. What's physically on hand Dec 31, at cost. */
  endingInventory: number;
  /** Combined state + local sales tax rate on materials, e.g. 0.07. */
  salesTaxRate: number;
  /** Did the nursery/supplier charge you sales tax on these purchases? */
  salesTaxPaidOnMaterials: boolean;
  /** What you bill customers for plants vs. what they cost you (e.g. 2 = 100% markup). */
  plantMarkup: number;
  rates: TaxRates;
  /** Locked-in choice. Null = use the recommendation. */
  plantTreatment: PlantTreatment | null;
  /** Last year's ending inventory, if the app has it, to check line 35. */
  priorYearEndingInventory?: number | null;
  priorYearTreatment?: PlantTreatment | null;
}

export interface LineTotal {
  id: ScheduleCLineId;
  label: string;
  description: string;
  part: "I" | "II" | "III";
  amount: number;
  /** Category breakdown so every number is traceable to transactions. */
  sources: { category: CategoryKey; label: string; amount: number; count: number }[];
}

export interface ScheduleCResult {
  treatment: PlantTreatment;
  lines: LineTotal[];
  grossReceipts: number;
  returns: number;
  costOfGoodsSold: number;
  grossProfit: number;
  otherIncome: number;
  grossIncome: number;
  totalExpenses: number;
  netProfit: number;
}

export interface TreatmentScenario {
  treatment: PlantTreatment;
  netProfit: number;
  taxes: TaxEstimate;
  /** Sales/use tax on materials the business pays itself. */
  salesTaxBorneByBusiness: number;
  /** Sales tax added to customer invoices (they pay it, you remit it). */
  salesTaxChargedToCustomers: number;
  /** Income tax + SE tax + sales/use tax the business pays. */
  businessTaxTotal: number;
  requirements: string[];
}

export interface PlantDecision {
  materialsSpend: number;
  materialsCostBeforeTax: number;
  scenarios: Record<PlantTreatment, TreatmentScenario>;
  recommended: PlantTreatment;
  savings: number;
  explanation: string;
}

export type AuditLevel = "high" | "medium" | "info";

export interface AuditFlag {
  level: AuditLevel;
  title: string;
  detail: string;
  transactionIds?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyLines(): Map<ScheduleCLineId, LineTotal> {
  return new Map(
    SCHEDULE_C_LINES.map((line) => [
      line.id,
      { id: line.id, label: line.label, description: line.description, part: line.part, amount: 0, sources: [] },
    ])
  );
}

function addTo(lines: Map<ScheduleCLineId, LineTotal>, lineId: ScheduleCLineId, category: CategoryKey, amount: number, count: number) {
  const line = lines.get(lineId)!;
  line.amount = round2(line.amount + amount);
  const existing = line.sources.find((s) => s.category === category);
  if (existing) {
    existing.amount = round2(existing.amount + amount);
    existing.count += count;
  } else {
    line.sources.push({ category, label: getCategory(category).label, amount: round2(amount), count });
  }
}

/** Totals by category for the year. Money out is returned as a positive number for expense categories. */
export function totalsByCategory(transactions: ReportTransaction[]) {
  const totals = new Map<CategoryKey, { amount: number; count: number }>();
  for (const tx of transactions) {
    const t = totals.get(tx.category) ?? { amount: 0, count: 0 };
    t.amount = round2(t.amount + tx.amount);
    t.count += 1;
    totals.set(tx.category, t);
  }
  return totals;
}

/**
 * Add up the year into Schedule C lines.
 *
 * Under "sell", plants and materials are inventory: Part III line 36, with
 * beginning/ending inventory on lines 35/41. Under "install", they are
 * materials used in a service: Part II line 22. Year-end inventory on hand
 * is held back in both cases (materials aren't deductible until used), so
 * net profit only differs if the inputs differ.
 */
export function buildScheduleC(
  transactions: ReportTransaction[],
  settings: Pick<YearSettings, "beginningInventory" | "endingInventory">,
  treatment: PlantTreatment,
  /** Optional override of materials spend (used by the scenario comparison). */
  materialsOverride?: number
): ScheduleCResult {
  const lines = emptyLines();
  const totals = totalsByCategory(transactions);

  for (const [category, { amount, count }] of totals) {
    const cat = getCategory(category);
    const target = cat.target;

    if (target.kind === "excluded" || target.kind === "review") continue;

    if (target.kind === "job_materials") {
      const spend = materialsOverride ?? -amount;
      addTo(lines, treatment === "sell" ? "36" : "22", category, spend, count);
      continue;
    }

    // Income lines are money in; refunds/expenses are money out.
    let value = target.line === "1" || target.line === "6" ? amount : -amount;
    if (target.deductiblePct !== undefined) value = value * target.deductiblePct;

    // Freight on materials follows the materials.
    const lineId = category === "freight_in" && treatment === "install" ? "22" : target.line;
    addTo(lines, lineId, category, value, count);
  }

  if (treatment === "sell") {
    lines.get("35")!.amount = round2(settings.beginningInventory);
    lines.get("41")!.amount = round2(settings.endingInventory);
  } else {
    // Materials on hand at year end aren't used yet: hold them back from line 22.
    // Materials on hand at the start of the year were used this year: add them.
    const adjustment = settings.beginningInventory - settings.endingInventory;
    if (adjustment !== 0) {
      addTo(lines, "22", "job_materials", adjustment, 0);
    }
  }

  const cogs =
    treatment === "sell"
      ? round2(
          lines.get("35")!.amount +
            lines.get("36")!.amount +
            lines.get("37")!.amount +
            lines.get("38")!.amount +
            lines.get("39")!.amount -
            lines.get("41")!.amount
        )
      : round2(lines.get("37")!.amount + lines.get("38")!.amount + lines.get("39")!.amount);
  lines.get("4")!.amount = cogs;

  const grossReceipts = lines.get("1")!.amount;
  const returns = lines.get("2")!.amount;
  const grossProfit = round2(grossReceipts - returns - cogs);
  const otherIncome = lines.get("6")!.amount;
  const grossIncome = round2(grossProfit + otherIncome);

  const totalExpenses = round2(
    SCHEDULE_C_LINES.filter((l) => l.part === "II").reduce((sum, l) => sum + lines.get(l.id)!.amount, 0)
  );

  return {
    treatment,
    lines: [...lines.values()],
    grossReceipts,
    returns,
    costOfGoodsSold: cogs,
    grossProfit,
    otherIncome,
    grossIncome,
    totalExpenses,
    netProfit: round2(grossIncome - totalExpenses),
  };
}

/**
 * Compare selling plants (retail, inventory/COGS) against installing them
 * (materials used in a service) and pick the one with the lower tax bill
 * for the business.
 *
 * On the federal return the two only move plant costs between line 4 and
 * line 22; with honest year-end counts, net profit is the same. The real
 * difference is sales tax:
 * - Install: you're the end consumer. You pay sales tax on materials (or owe
 *   use tax if the supplier didn't charge it). It's a cost, and deductible.
 * - Sell: you buy for resale tax-free with a resale certificate, then charge
 *   customers sales tax on the plants' selling price and remit it.
 * State rules decide whether you get to choose at all, so the requirements
 * list goes with the recommendation.
 */
export function comparePlantTreatments(transactions: ReportTransaction[], settings: YearSettings): PlantDecision {
  const totals = totalsByCategory(transactions);
  const materialsSpend = round2(-(totals.get("job_materials")?.amount ?? 0));
  const r = Math.max(0, settings.salesTaxRate);
  const preTax = settings.salesTaxPaidOnMaterials ? materialsSpend / (1 + r) : materialsSpend;

  const installMaterials = round2(preTax * (1 + r)); // tax paid at the register or as use tax
  const sellMaterials = round2(preTax);

  const installReport = buildScheduleC(transactions, settings, "install", installMaterials);
  const sellReport = buildScheduleC(transactions, settings, "sell", sellMaterials);

  const installTaxes = estimateTaxes(installReport.netProfit, settings.taxYear, settings.rates);
  const sellTaxes = estimateTaxes(sellReport.netProfit, settings.taxYear, settings.rates);

  const installSalesTax = round2(preTax * r);
  const usedPlantsCost = Math.max(0, preTax + settings.beginningInventory - settings.endingInventory);
  const customerSalesTax = round2(usedPlantsCost * Math.max(1, settings.plantMarkup) * r);

  const install: TreatmentScenario = {
    treatment: "install",
    netProfit: installReport.netProfit,
    taxes: installTaxes,
    salesTaxBorneByBusiness: installSalesTax,
    salesTaxChargedToCustomers: 0,
    businessTaxTotal: round2(installTaxes.total + installSalesTax),
    requirements: [
      "Bill each job as one installed price (labor + materials together); don't charge customers sales tax on plants.",
      settings.salesTaxPaidOnMaterials
        ? "Keep paying sales tax when you buy plants and materials."
        : "Your suppliers didn't charge sales tax, so you owe use tax on these purchases. File and pay it with your state.",
      "Plants and materials go on line 22 (Supplies). Count what's left on hand Dec 31; it isn't deductible until used.",
    ],
  };

  const sell: TreatmentScenario = {
    treatment: "sell",
    netProfit: sellReport.netProfit,
    taxes: sellTaxes,
    salesTaxBorneByBusiness: 0,
    salesTaxChargedToCustomers: customerSalesTax,
    businessTaxTotal: sellTaxes.total,
    requirements: [
      "Get a state sales tax permit and give suppliers a resale certificate so they stop charging you sales tax.",
      "List plants as their own line on every invoice and charge sales tax on them. Labor stays a separate line.",
      "File sales tax returns and remit what you collect.",
      "Plants go in Part III (line 36) with a real Dec 31 inventory count on line 41.",
      "Check your state's rules first: some states treat landscapers as the consumer of the plants they install, and some tax the whole installed job.",
    ],
  };

  const savings = round2(install.businessTaxTotal - sell.businessTaxTotal);
  const recommended: PlantTreatment = savings > 0.5 ? "sell" : "install";

  let explanation: string;
  if (materialsSpend === 0) {
    explanation = "No job-material purchases are categorized for this year yet, so there's nothing to compare.";
  } else if (r === 0) {
    explanation =
      "With no sales tax on materials, both treatments give the same federal profit. Installing is simpler (no sales tax permit or filings), so it's the default.";
  } else if (recommended === "sell") {
    explanation = `Selling plants saves the business about $${savings.toLocaleString("en-US", { maximumFractionDigits: 0 })} because you'd stop paying sales tax on materials. The tradeoff: customers pay about $${customerSalesTax.toLocaleString("en-US", { maximumFractionDigits: 0 })} in sales tax on the plants, which raises their invoices.`;
  } else {
    explanation = "Installing comes out the same or cheaper, and it's simpler to run.";
  }

  return {
    materialsSpend,
    materialsCostBeforeTax: round2(preTax),
    scenarios: { install, sell },
    recommended,
    savings: Math.max(0, savings),
    explanation,
  };
}

const PERSONAL_PATTERNS = BUILT_IN_RULES.filter((r) => r.category === "personal").map((r) => r.pattern);

/**
 * Things an IRS reviewer would question, ranked. These are heuristics, not
 * IRS formulas (the IRS doesn't publish its scoring), based on what the
 * instructions require you to document and common audit triggers.
 */
export function auditChecks(
  transactions: ReportTransaction[],
  report: ScheduleCResult,
  settings: YearSettings
): AuditFlag[] {
  const flags: AuditFlag[] = [];
  const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const line = (id: ScheduleCLineId) => report.lines.find((l) => l.id === id)?.amount ?? 0;

  const review = transactions.filter((t) => t.needs_review || t.category === "uncategorized");
  if (review.length > 0) {
    const total = review.reduce((s, t) => s + Math.abs(t.amount), 0);
    flags.push({
      level: "high",
      title: `${review.length} transactions still need review`,
      detail: `${money(total)} isn't confirmed. Uncategorized items aren't counted at all, and guessed ones may be on the wrong line.`,
      transactionIds: review.map((t) => t.id),
    });
  }

  const mismatched = transactions.filter((t) => directionMismatch(t.category, t.amount));
  if (mismatched.length > 0) {
    flags.push({
      level: "medium",
      title: "Money moving the wrong way for its category",
      detail: "Deposits in an expense category (or payments in an income category). Usually a vendor refund or a mis-click; confirm each.",
      transactionIds: mismatched.map((t) => t.id),
    });
  }

  if (report.netProfit < 0) {
    flags.push({
      level: "medium",
      title: `Schedule C shows a loss of ${money(report.netProfit)}`,
      detail: "Losses get more scrutiny, especially several years in a row (hobby-loss rules). Make sure every deposit is counted and every expense is truly business.",
    });
  }

  const receipts = Math.max(1, report.grossReceipts);
  const meals = line("24b") * 2; // full amount spent
  if (meals > 0 && meals / receipts > 0.02) {
    flags.push({
      level: "medium",
      title: "Meals are high for a field-service business",
      detail: `${money(meals)} on meals (${((meals / receipts) * 100).toFixed(1)}% of sales). Each needs who, where and the business reason. Crew lunches on a normal workday are usually personal.`,
    });
  }

  const vehicle = line("9");
  if (vehicle > 0) {
    flags.push({
      level: vehicle / receipts > 0.15 ? "medium" : "info",
      title: "Vehicle expenses need a mileage log",
      detail: `${money(vehicle)} on line 9. You need a log of business vs. personal miles. Use either standard mileage or actual costs × business %, never both. Claiming 100% business use of a truck you also drive personally is a common audit flag.`,
    });
  }

  const other = line("27b");
  if (report.totalExpenses > 0 && other / report.totalExpenses > 0.1) {
    flags.push({
      level: "medium",
      title: "Too much in Other expenses",
      detail: `${money(other)} (${((other / report.totalExpenses) * 100).toFixed(0)}% of expenses) is on line 27b. Large "other" totals draw attention; move anything that fits a named line.`,
    });
  }

  const bigNonAsset = transactions.filter(
    (t) => t.amount < -2500 && ["supplies", "repairs", "office_software", "other_expense"].includes(t.category)
  );
  if (bigNonAsset.length > 0) {
    flags.push({
      level: "medium",
      title: "Purchases over $2,500 expensed as supplies or repairs",
      detail: "Single items over the $2,500 de minimis limit usually belong in Equipment / asset purchase (line 13, Form 4562). You can still write most of it off this year, just on the right form.",
      transactionIds: bigNonAsset.map((t) => t.id),
    });
  }

  const roundBig = transactions.filter(
    (t) => t.amount <= -500 && Math.abs(t.amount) % 100 === 0 && !["transfer", "credit_card_payment", "owner_draw", "loan_principal", "income_tax_payment"].includes(t.category)
  );
  if (roundBig.length > 0) {
    flags.push({
      level: "info",
      title: "Round-dollar expenses",
      detail: "Even amounts like $1,000 look estimated. Keep an invoice or receipt for each.",
      transactionIds: roundBig.map((t) => t.id),
    });
  }

  const personalLooking = transactions.filter((t) => {
    const cat = getCategory(t.category);
    if (cat.target.kind !== "line" && cat.target.kind !== "job_materials") return false;
    return t.amount < 0 && PERSONAL_PATTERNS.some((p) => p.test(t.description));
  });
  if (personalLooking.length > 0) {
    flags.push({
      level: "high",
      title: "Personal-looking purchases deducted",
      detail: "Groceries, streaming and similar merchants are categorized as business. Mixing personal spending into business deductions is the fastest way to lose credibility in an audit.",
      transactionIds: personalLooking.map((t) => t.id),
    });
  }

  const threshold = yearConstants(settings.taxYear).form1099Threshold;
  const byPayee = new Map<string, { total: number; ids: string[] }>();
  for (const t of transactions.filter((t) => t.category === "contract_labor" && t.amount < 0)) {
    const key = merchantKey(t.description) || t.description;
    const entry = byPayee.get(key) ?? { total: 0, ids: [] };
    entry.total += -t.amount;
    entry.ids.push(t.id);
    byPayee.set(key, entry);
  }
  const needs1099 = [...byPayee.entries()].filter(([, v]) => v.total >= threshold);
  if (needs1099.length > 0) {
    flags.push({
      level: "medium",
      title: `${needs1099.length} contractor(s) likely need a 1099-NEC`,
      detail: `Paid ${money(threshold)} or more this year: ${needs1099.map(([k, v]) => `${k} (${money(v.total)})`).join(", ")}. File by January 31 and keep a W-9 for each.`,
      transactionIds: needs1099.flatMap(([, v]) => v.ids),
    });
  }

  const cash = transactions.filter((t) => t.amount < 0 && /\b(atm|cash\s*withdrawal)\b/i.test(t.description) && getCategory(t.category).target.kind === "line");
  if (cash.length > 0) {
    flags.push({
      level: "medium",
      title: "Cash withdrawals deducted as expenses",
      detail: "A cash withdrawal isn't proof of a business expense. Deduct it only if you have receipts for what the cash bought (e.g. paying day labor, with names and amounts).",
      transactionIds: cash.map((t) => t.id),
    });
  }

  const materials = transactions.filter((t) => t.category === "job_materials").length;
  if (materials > 0 && settings.endingInventory === 0) {
    flags.push({
      level: "info",
      title: "Ending inventory is $0",
      detail: "Confirm nothing was on hand Dec 31 (plants in the yard, pallets of stone, bags of mulch). Leftover materials aren't deductible until used.",
    });
  }

  if (
    settings.priorYearEndingInventory !== undefined &&
    settings.priorYearEndingInventory !== null &&
    Math.abs(settings.priorYearEndingInventory - settings.beginningInventory) > 0.5
  ) {
    flags.push({
      level: "high",
      title: "Beginning inventory doesn't match last year",
      detail: `Line 35 is ${money(settings.beginningInventory)} but last year's ending inventory was ${money(settings.priorYearEndingInventory)}. They must match.`,
    });
  }

  if (settings.priorYearTreatment && settings.plantTreatment && settings.priorYearTreatment !== settings.plantTreatment) {
    flags.push({
      level: "medium",
      title: "Plant treatment changed from last year",
      detail: "Switching between selling and installing should reflect a real change in how you invoice and handle sales tax, starting at the beginning of the year. Changing how inventory is accounted for can require Form 3115; ask your CPA.",
    });
  }

  if (report.grossReceipts > 0) {
    flags.push({
      level: "info",
      title: "Reconcile gross receipts to 1099-Ks",
      detail: "Stripe, Square and PayPal report your gross sales to the IRS on 1099-K. Line 1 should be at least that total (before fees). Fees go on line 10.",
    });
  }

  const order: Record<AuditLevel, number> = { high: 0, medium: 1, info: 2 };
  return flags.sort((a, b) => order[a.level] - order[b.level]);
}

export { CATEGORIES, LINE_BY_ID };
