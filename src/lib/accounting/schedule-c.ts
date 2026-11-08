/**
 * IRS Schedule C (Form 1040), Profit or Loss From Business, as data.
 *
 * Every bank transaction gets exactly one `CategoryKey`. Each category maps
 * to one Schedule C line (or to "not on Schedule C" for transfers, owner
 * draws, loan principal and personal spending). The report in
 * `report.ts` adds categories up into lines; nothing else should decide
 * which line a dollar lands on.
 *
 * Line numbers and wording follow the current Schedule C and its
 * instructions. Check them against the year's form before filing.
 */

export type ScheduleCLineId =
  | "1" | "2" | "4" | "6"
  | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15" | "16a" | "16b" | "17" | "18"
  | "19" | "20a" | "20b" | "21" | "22" | "23" | "24a" | "24b" | "25" | "26" | "27a" | "27b"
  | "30"
  | "35" | "36" | "37" | "38" | "39" | "41";

export interface ScheduleCLine {
  id: ScheduleCLineId;
  part: "I" | "II" | "III";
  label: string;
  /** Plain-English summary of what the IRS instructions put on this line. */
  description: string;
}

export const SCHEDULE_C_LINES: ScheduleCLine[] = [
  // Part I: Income
  { id: "1", part: "I", label: "Gross receipts or sales", description: "All money customers paid you for work and products, including card payouts (Stripe, Square) and checks. Must reconcile to any 1099-K/1099-NEC you receive." },
  { id: "2", part: "I", label: "Returns and allowances", description: "Refunds and credits you gave customers." },
  { id: "4", part: "I", label: "Cost of goods sold (from line 42)", description: "Part III total. Only used when you sell products or keep inventory." },
  { id: "6", part: "I", label: "Other income", description: "Business income that isn't from sales: vendor rebates, interest on business accounts, scrap sales, fuel tax credits." },

  // Part II: Expenses
  { id: "8", part: "II", label: "Advertising", description: "Ads, lead services, yard signs, truck wraps, business cards, website ads." },
  { id: "9", part: "II", label: "Car and truck expenses", description: "Business use of vehicles. Either standard mileage (log required) OR actual costs (fuel, repairs, insurance) times business-use %, not both." },
  { id: "10", part: "II", label: "Commissions and fees", description: "Card processing fees, marketplace fees, sales commissions paid to non-employees." },
  { id: "11", part: "II", label: "Contract labor", description: "Payments to independent contractors (not employees). A 1099-NEC is required for each payee over the annual threshold." },
  { id: "12", part: "II", label: "Depletion", description: "Natural resource property (timber, minerals). Rare for service businesses." },
  { id: "13", part: "II", label: "Depreciation and section 179 expense", description: "Equipment, trailers, vehicles and other assets that last more than a year, via Form 4562 (section 179 or bonus depreciation)." },
  { id: "14", part: "II", label: "Employee benefit programs", description: "Health, life and other benefit plans for employees (not for yourself)." },
  { id: "15", part: "II", label: "Insurance (other than health)", description: "General liability, workers' comp, business property, commercial umbrella. Vehicle insurance goes on line 9 under the actual-expense method." },
  { id: "16a", part: "II", label: "Interest: mortgage", description: "Mortgage interest on business real estate, paid to banks (Form 1098)." },
  { id: "16b", part: "II", label: "Interest: other", description: "Interest on business loans, equipment financing and business credit cards. Principal is never deductible." },
  { id: "17", part: "II", label: "Legal and professional services", description: "Accountants, bookkeepers, tax prep for the business, attorneys, business formation fees." },
  { id: "18", part: "II", label: "Office expense", description: "Office supplies, postage, printer ink, and business software subscriptions." },
  { id: "19", part: "II", label: "Pension and profit-sharing plans", description: "Retirement contributions for employees (your own SEP/solo 401k goes on Schedule 1, not here)." },
  { id: "20a", part: "II", label: "Rent or lease: vehicles, machinery, equipment", description: "Equipment rentals (skid steers, aerators, lifts), leased trucks." },
  { id: "20b", part: "II", label: "Rent or lease: other business property", description: "Shop, yard, storage unit or office rent." },
  { id: "21", part: "II", label: "Repairs and maintenance", description: "Repairs to equipment and business property that don't add value or extend life (blades, belts, small engine repair). Vehicle repairs go on line 9." },
  { id: "22", part: "II", label: "Supplies (not included in Part III)", description: "Consumables used in the work: hand tools, trimmer line, chemicals, fuel for equipment, safety gear. Job materials go here when you install them as a service." },
  { id: "23", part: "II", label: "Taxes and licenses", description: "Business licenses, permits, employer payroll taxes, sales tax you paid on business purchases (if not in the item's cost), vehicle registration. Never your own income tax." },
  { id: "24a", part: "II", label: "Travel", description: "Overnight business travel: lodging, airfare, rideshare away from your tax home." },
  { id: "24b", part: "II", label: "Deductible meals", description: "Business meals with a clear business purpose, at 50% of cost. Keep the receipt and who/why." },
  { id: "25", part: "II", label: "Utilities", description: "Business phone lines, internet, shop electric, water and gas." },
  { id: "26", part: "II", label: "Wages (less employment credits)", description: "W-2 employee gross pay. Not owner draws." },
  { id: "27a", part: "II", label: "Energy efficient commercial buildings deduction", description: "Form 7205. Rare." },
  { id: "27b", part: "II", label: "Other expenses (from line 48)", description: "Real business costs that fit no other line, listed by type in Part V: bank fees, dump/disposal fees, uniforms, dues and subscriptions, training." },
  { id: "30", part: "II", label: "Business use of home", description: "Form 8829 or simplified method. Requires regular and exclusive business use of the space." },

  // Part III: Cost of Goods Sold
  { id: "35", part: "III", label: "Inventory at beginning of year", description: "Value of plants and materials on hand January 1 (must match last year's ending inventory)." },
  { id: "36", part: "III", label: "Purchases less cost of items withdrawn for personal use", description: "Plants and products bought to resell to customers." },
  { id: "37", part: "III", label: "Cost of labor", description: "Labor directly producing the goods. Don't double-count with line 26." },
  { id: "38", part: "III", label: "Materials and supplies", description: "Materials that become part of what you sell." },
  { id: "39", part: "III", label: "Other costs", description: "Freight-in and other costs to get the goods ready to sell." },
  { id: "41", part: "III", label: "Inventory at end of year", description: "Value of plants and materials still on hand December 31 (count them). Subtracted from COGS." },
];

export const LINE_BY_ID = new Map(SCHEDULE_C_LINES.map((line) => [line.id, line]));

/**
 * Where a category lands.
 * - `line`: a fixed Schedule C line.
 * - `job_materials`: plants/mulch/soil. Part III line 36 if you sell them,
 *   Part II line 22 if you install them as part of a service. Decided per
 *   tax year in the report (see plant-treatment comparison).
 * - `excluded`: not income or expense (transfers, draws, loans, personal).
 * - `review`: not decided yet. Never counted until someone picks a category.
 */
export type CategoryTarget =
  | { kind: "line"; line: ScheduleCLineId; deductiblePct?: number }
  | { kind: "job_materials" }
  | { kind: "excluded" }
  | { kind: "review" };

export interface Category {
  key: string;
  label: string;
  target: CategoryTarget;
  /** "in" = money in, "out" = money out, "either" = both. Used to sanity-check. */
  direction: "in" | "out" | "either";
  /** Shown in the picker and the report so the choice is explainable. */
  help: string;
  /** Extra caution shown on the report (documentation needed, etc.). */
  auditNote?: string;
}

export const CATEGORIES = [
  // Income
  { key: "income_sales", label: "Customer payment (sales)", target: { kind: "line", line: "1" }, direction: "in", help: "Payments from customers and card-processor payouts." },
  { key: "customer_refund", label: "Refund given to customer", target: { kind: "line", line: "2" }, direction: "out", help: "Money returned to a customer." },
  { key: "income_other", label: "Other business income", target: { kind: "line", line: "6" }, direction: "in", help: "Rebates, interest on business accounts, scrap." },

  // Job materials (the sell-vs-install decision)
  { key: "job_materials", label: "Job materials (plants, mulch, soil, stone)", target: { kind: "job_materials" }, direction: "out", help: "Plants and landscape materials that end up at the customer's property. Line 36 (COGS) or line 22 (supplies), decided for the whole year on the Schedule C page.", auditNote: "Count what's left on hand at year end. Unused materials aren't deductible until used." },
  { key: "freight_in", label: "Freight/delivery on materials", target: { kind: "line", line: "39" }, direction: "out", help: "Delivery charges for materials you resell." },

  // Part II expenses
  { key: "advertising", label: "Advertising & marketing", target: { kind: "line", line: "8" }, direction: "out", help: "Google/Meta ads, lead services, signs, wraps." },
  { key: "vehicle", label: "Vehicle: fuel, repairs, insurance", target: { kind: "line", line: "9" }, direction: "out", help: "Truck fuel, maintenance, tires, registration under the actual-expense method.", auditNote: "Keep a mileage log. Business-use % must be documented; 100% business use of a vehicle is a common audit flag." },
  { key: "processing_fees", label: "Card processing / platform fees", target: { kind: "line", line: "10" }, direction: "out", help: "Stripe, Square, PayPal fees." },
  { key: "contract_labor", label: "Contract labor (1099 subs)", target: { kind: "line", line: "11" }, direction: "out", help: "Subcontractors and independent helpers.", auditNote: "Collect a W-9 from every payee. Issue a 1099-NEC to anyone paid over the threshold for the year." },
  { key: "equipment_asset", label: "Equipment / asset purchase", target: { kind: "line", line: "13" }, direction: "out", help: "Mowers, trailers, skid steers, trucks: anything lasting over a year that costs more than the $2,500 de minimis limit.", auditNote: "Report on Form 4562 (section 179 or bonus depreciation). Keep the invoice." },
  { key: "employee_benefits", label: "Employee benefits", target: { kind: "line", line: "14" }, direction: "out", help: "Employee health plans and similar." },
  { key: "insurance", label: "Business insurance", target: { kind: "line", line: "15" }, direction: "out", help: "General liability, workers' comp, equipment coverage." },
  { key: "interest_mortgage", label: "Mortgage interest (business property)", target: { kind: "line", line: "16a" }, direction: "out", help: "Only the interest portion." },
  { key: "interest_other", label: "Interest & finance charges", target: { kind: "line", line: "16b" }, direction: "out", help: "Interest on business loans, equipment financing, business cards." },
  { key: "professional_services", label: "Legal & professional", target: { kind: "line", line: "17" }, direction: "out", help: "CPA, bookkeeper, attorney, filing fees." },
  { key: "office_software", label: "Office & software", target: { kind: "line", line: "18" }, direction: "out", help: "Office supplies, postage, CRM/estimating/accounting software." },
  { key: "retirement_plans", label: "Employee retirement plans", target: { kind: "line", line: "19" }, direction: "out", help: "Employer contributions for employees only." },
  { key: "equipment_rental", label: "Equipment / vehicle rental", target: { kind: "line", line: "20a" }, direction: "out", help: "Sunbelt, United Rentals, Home Depot tool rental." },
  { key: "rent_property", label: "Rent: shop, yard, storage", target: { kind: "line", line: "20b" }, direction: "out", help: "Rent for business space." },
  { key: "repairs", label: "Equipment repairs & maintenance", target: { kind: "line", line: "21" }, direction: "out", help: "Small engine repair, blades, belts, parts." },
  { key: "supplies", label: "Supplies, tools & equipment fuel", target: { kind: "line", line: "22" }, direction: "out", help: "Hand tools, trimmer line, chemicals, PPE, gas for mowers. Items over $2,500 go to Equipment." },
  { key: "taxes_licenses", label: "Taxes, licenses & permits", target: { kind: "line", line: "23" }, direction: "out", help: "Business license, pesticide license, permits, employer payroll tax, sales tax remitted on business purchases." },
  { key: "sales_tax_remitted", label: "Sales tax remitted to state", target: { kind: "line", line: "23" }, direction: "out", help: "Sales tax collected from customers and sent to the state. Customer deposits include the tax, so it's in line 1 and comes back out here." },
  { key: "travel", label: "Travel (overnight)", target: { kind: "line", line: "24a" }, direction: "out", help: "Lodging and airfare for business trips." },
  { key: "meals", label: "Business meals (50%)", target: { kind: "line", line: "24b", deductiblePct: 0.5 }, direction: "out", help: "Meals with a business purpose. Only 50% counts.", auditNote: "Write down who was there and the business reason. Crew lunches on a normal workday are usually personal." },
  { key: "utilities_phone", label: "Phone, internet & utilities", target: { kind: "line", line: "25" }, direction: "out", help: "Business cell lines, internet, shop utilities." },
  { key: "wages", label: "Payroll wages (W-2)", target: { kind: "line", line: "26" }, direction: "out", help: "Net pay and payroll-service debits for employee wages.", auditNote: "Match to your W-2/W-3 and Form 941 totals. Withheld taxes belong to wages, the employer share to line 23." },
  { key: "bank_fees", label: "Bank fees", target: { kind: "line", line: "27b" }, direction: "out", help: "Monthly service charges, wire fees." },
  { key: "disposal_fees", label: "Dump & disposal fees", target: { kind: "line", line: "27b" }, direction: "out", help: "Landfill, green-waste, dumpster fees." },
  { key: "uniforms", label: "Uniforms & safety gear", target: { kind: "line", line: "27b" }, direction: "out", help: "Branded shirts, boots required for work." },
  { key: "dues_training", label: "Dues, subscriptions & training", target: { kind: "line", line: "27b" }, direction: "out", help: "Trade associations, certifications, courses." },
  { key: "other_expense", label: "Other business expense", target: { kind: "line", line: "27b" }, direction: "out", help: "Real business cost that fits nowhere else.", auditNote: "Part V needs a description for each type. Keep this small." },
  { key: "home_office", label: "Business use of home", target: { kind: "line", line: "30" }, direction: "out", help: "Rarely comes from the bank feed. Use Form 8829 or the simplified method." },

  // Not on Schedule C
  { key: "transfer", label: "Transfer between own accounts", target: { kind: "excluded" }, direction: "either", help: "Moves between your checking, savings and cards. Never income or expense." },
  { key: "credit_card_payment", label: "Credit card payment", target: { kind: "excluded" }, direction: "out", help: "Paying the card. The individual card charges are the expenses." },
  { key: "owner_draw", label: "Owner draw / personal transfer", target: { kind: "excluded" }, direction: "out", help: "Money you took out for yourself." },
  { key: "owner_contribution", label: "Owner contribution", target: { kind: "excluded" }, direction: "in", help: "Your own money put into the business. Not income." },
  { key: "loan_proceeds", label: "Loan proceeds", target: { kind: "excluded" }, direction: "in", help: "Money borrowed. Not income." },
  { key: "loan_principal", label: "Loan payment (principal)", target: { kind: "excluded" }, direction: "out", help: "Principal isn't deductible. Split out the interest to Interest & finance charges." },
  { key: "income_tax_payment", label: "Income tax payment (IRS/state)", target: { kind: "excluded" }, direction: "out", help: "Estimated or annual income tax. Never a business deduction." },
  { key: "personal", label: "Personal (not business)", target: { kind: "excluded" }, direction: "either", help: "Groceries, streaming, personal shopping. Kept off the return." },
  { key: "uncategorized", label: "Needs review", target: { kind: "review" }, direction: "either", help: "Not decided yet." },
] as const satisfies readonly Category[];

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const CATEGORY_BY_KEY = new Map<string, Category>(CATEGORIES.map((c) => [c.key, c]));

export function isCategoryKey(value: string): value is CategoryKey {
  return CATEGORY_BY_KEY.has(value);
}

export function getCategory(key: string): Category {
  return CATEGORY_BY_KEY.get(key) ?? CATEGORY_BY_KEY.get("uncategorized")!;
}
