import { describe, expect, it } from "vitest";

import { csvExternalIds, parseAmount, parseDate, parseStatementCsv } from "./csv";
import { auditChecks, buildScheduleC, comparePlantTreatments, type ReportTransaction, type YearSettings } from "./report";
import { categorize, merchantKey } from "./rules";
import { CATEGORIES, LINE_BY_ID } from "./schedule-c";
import { estimateTaxes, selfEmploymentTax } from "./tax-estimate";

describe("csv", () => {
  it("parses a signed-amount bank export with junk above the header", () => {
    const csv = [
      "Account Name: Business Checking",
      "",
      "Date,Description,Amount,Balance",
      '01/03/2026,"SITEONE LANDSCAPE #123, ATLANTA GA",-1,234.56,5000',
      '01/04/2026,"STRIPE TRANSFER","$2,500.00",7500',
      "01/05/2026,Monthly fee,(15.00),7485",
    ].join("\n");
    // Unquoted "-1,234.56" splits into two cells, so quote properly:
    const fixed = csv.replace("-1,234.56", '"-1,234.56"');
    const result = parseStatementCsv(fixed);
    expect(result.rows).toEqual([
      { postedOn: "2026-01-03", description: "SITEONE LANDSCAPE #123, ATLANTA GA", amount: -1234.56 },
      { postedOn: "2026-01-04", description: "STRIPE TRANSFER", amount: 2500 },
      { postedOn: "2026-01-05", description: "Monthly fee", amount: -15 },
    ]);
  });

  it("handles debit/credit columns", () => {
    const csv = "Posting Date,Payee,Debit,Credit\n2026-02-01,Shell Oil,45.10,\n2026-02-02,Mobile Deposit,,800\n";
    expect(parseStatementCsv(csv).rows.map((r) => r.amount)).toEqual([-45.1, 800]);
  });

  it("flips card exports where purchases are positive", () => {
    const csv = "Date,Description,Amount\n03/01/26,HOME DEPOT,99.99\n03/02/26,PAYMENT THANK YOU,-500\n";
    const rows = parseStatementCsv(csv, { purchasesArePositive: true }).rows;
    expect(rows.map((r) => r.amount)).toEqual([-99.99, 500]);
    expect(rows[0].postedOn).toBe("2026-03-01");
  });

  it("rejects bad dates and amounts", () => {
    expect(parseDate("13/45/2026")).toBeNull();
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12.00 DR")).toBe(-12);
  });

  it("gives duplicate same-day charges distinct, stable ids", () => {
    const rows = [
      { postedOn: "2026-01-01", description: "Wawa", amount: -5 },
      { postedOn: "2026-01-01", description: "Wawa", amount: -5 },
    ];
    const ids = csvExternalIds("acct", rows);
    expect(new Set(ids).size).toBe(2);
    expect(csvExternalIds("acct", rows)).toEqual(ids);
  });
});

describe("categorize", () => {
  it("maps landscaping vendors and common merchants", () => {
    expect(categorize({ description: "SITEONE LANDSCAPE SUPPLY #445", amount: -900 }).category).toBe("job_materials");
    expect(categorize({ description: "GOOGLE *ADS1234", amount: -300 }).category).toBe("advertising");
    expect(categorize({ description: "STRIPE TRANSFER ST-ABC", amount: 4000 }).category).toBe("income_sales");
    expect(categorize({ description: "STRIPE FEE", amount: -12 }).category).toBe("processing_fees");
    expect(categorize({ description: "QUICKBOOKS PAYROLL", amount: -3000 }).category).toBe("wages");
    expect(categorize({ description: "IRS USATAXPYMT", amount: -2000 }).category).toBe("income_tax_payment");
    expect(categorize({ description: "CHASE CREDIT CRD AUTOPAY", amount: -1500 }).category).toBe("credit_card_payment");
    expect(categorize({ description: "MONTHLY SERVICE FEE", amount: -15 }).category).toBe("bank_fees");
  });

  it("flags ambiguous merchants for review", () => {
    const hd = categorize({ description: "THE HOME DEPOT #1234", amount: -80 });
    expect(hd.category).toBe("supplies");
    expect(hd.needsReview).toBe(true);
    expect(categorize({ description: "CHICK-FIL-A #01", amount: -14 }).category).toBe("meals");
    expect(categorize({ description: "NETFLIX.COM", amount: -15 }).category).toBe("personal");
  });

  it("never guesses an unknown expense into a deduction", () => {
    const r = categorize({ description: "XYZ LLC", amount: -250 });
    expect(r.category).toBe("uncategorized");
    expect(r.needsReview).toBe(true);
  });

  it("lets saved rules override built-ins", () => {
    const r = categorize({ description: "THE HOME DEPOT #1234", amount: -80 }, [{ match_text: "home depot", category: "job_materials" }]);
    expect(r).toMatchObject({ category: "job_materials", source: "user_rule", needsReview: false });
  });

  it("builds a merchant key without store numbers", () => {
    expect(merchantKey("POS DEBIT THE HOME DEPOT #0412 ATLANTA GA")).toBe("the home depot atlanta");
  });

  it("every category points at a real Schedule C line", () => {
    for (const c of CATEGORIES) {
      if (c.target.kind === "line") expect(LINE_BY_ID.has(c.target.line)).toBe(true);
    }
  });
});

const tx = (id: string, category: ReportTransaction["category"], amount: number, description = id): ReportTransaction => ({
  id,
  posted_on: "2026-05-01",
  description,
  amount,
  category,
  needs_review: false,
});

const baseSettings: YearSettings = {
  taxYear: 2026,
  beginningInventory: 0,
  endingInventory: 0,
  salesTaxRate: 0.07,
  salesTaxPaidOnMaterials: true,
  plantMarkup: 2,
  rates: { federalMarginalRate: 0.22, stateIncomeRate: 0.05, qbiDeduction: true },
  plantTreatment: null,
};

describe("buildScheduleC", () => {
  const txs = [
    tx("sale", "income_sales", 100_000),
    tx("plants", "job_materials", -20_000),
    tx("meal", "meals", -1_000),
    tx("fuel", "vehicle", -5_000),
    tx("xfer", "transfer", -10_000),
    tx("draw", "owner_draw", -30_000),
    tx("unknown", "uncategorized", -999),
  ];

  it("puts plants on line 36 when selling and line 22 when installing, same profit", () => {
    const settings = { beginningInventory: 1_000, endingInventory: 3_000 };
    const sell = buildScheduleC(txs, settings, "sell");
    const install = buildScheduleC(txs, settings, "install");

    const amt = (r: typeof sell, id: string) => r.lines.find((l) => l.id === id)!.amount;
    expect(amt(sell, "36")).toBe(20_000);
    expect(sell.costOfGoodsSold).toBe(18_000); // 1,000 + 20,000 - 3,000
    expect(amt(install, "22")).toBe(18_000);
    expect(install.costOfGoodsSold).toBe(0);

    // Meals at 50%, transfers/draws/uncategorized excluded.
    expect(amt(sell, "24b")).toBe(500);
    expect(sell.netProfit).toBe(100_000 - 18_000 - 500 - 5_000);
    expect(install.netProfit).toBe(sell.netProfit);
  });
});

describe("comparePlantTreatments", () => {
  it("recommends selling when it avoids sales tax on materials", () => {
    const txs = [tx("sale", "income_sales", 100_000), tx("plants", "job_materials", -21_400)];
    const decision = comparePlantTreatments(txs, baseSettings);
    expect(decision.materialsCostBeforeTax).toBe(20_000);
    expect(decision.scenarios.install.salesTaxBorneByBusiness).toBe(1_400);
    expect(decision.scenarios.sell.salesTaxChargedToCustomers).toBe(2_800); // 20k cost x 2 markup x 7%
    expect(decision.recommended).toBe("sell");
    expect(decision.savings).toBeGreaterThan(0);
    expect(decision.savings).toBeLessThan(1_400); // higher profit claws some back
  });

  it("defaults to install when there's no sales tax difference", () => {
    const txs = [tx("sale", "income_sales", 100_000), tx("plants", "job_materials", -20_000)];
    expect(comparePlantTreatments(txs, { ...baseSettings, salesTaxRate: 0 }).recommended).toBe("install");
  });
});

describe("taxes", () => {
  it("computes SE tax and skips small profits", () => {
    expect(selfEmploymentTax(300, 2026)).toBe(0);
    expect(selfEmploymentTax(100_000, 2026)).toBeCloseTo(100_000 * 0.9235 * 0.153, 1);
    expect(estimateTaxes(-5, 2026, baseSettings.rates).total).toBe(0);
  });
});

describe("auditChecks", () => {
  it("flags unreviewed items, personal merchants and 1099 payees", () => {
    const txs = [
      tx("sale", "income_sales", 50_000),
      { ...tx("u", "uncategorized", -100), needs_review: true },
      tx("nf", "office_software", -15, "NETFLIX.COM"),
      tx("c1", "contract_labor", -1_500, "ZELLE TO JOSE GARCIA"),
      tx("c2", "contract_labor", -1_500, "ZELLE TO JOSE GARCIA"),
    ];
    const report = buildScheduleC(txs, baseSettings, "install");
    const titles = auditChecks(txs, report, baseSettings).map((f) => f.title);
    expect(titles[0]).toMatch(/need review/);
    expect(titles).toContain("Personal-looking purchases deducted");
    expect(titles.some((t) => /1099-NEC/.test(t))).toBe(true);
  });
});
