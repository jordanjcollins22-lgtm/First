/**
 * Rough tax-on-this-business estimate, used only to compare choices
 * (e.g. selling plants vs. installing them). It is not a tax return:
 * no standard deduction, credits, other household income or brackets,
 * just this business's profit at the marginal rates you enter.
 */

interface YearConstants {
  /** Social Security wage base for self-employment tax. */
  ssWageBase: number;
  /** 1099-NEC filing threshold per payee. */
  form1099Threshold: number;
}

// Verify against SSA/IRS each year.
const CONSTANTS: Record<number, YearConstants> = {
  2024: { ssWageBase: 168_600, form1099Threshold: 600 },
  2025: { ssWageBase: 176_100, form1099Threshold: 600 },
  // The 2025 federal tax law raised the 1099-NEC threshold to $2,000 for
  // payments made after 2025.
  2026: { ssWageBase: 184_500, form1099Threshold: 2_000 },
};

export function yearConstants(year: number): YearConstants {
  if (CONSTANTS[year]) return CONSTANTS[year];
  const years = Object.keys(CONSTANTS).map(Number).sort((a, b) => a - b);
  const nearest = year < years[0] ? years[0] : years[years.length - 1];
  return CONSTANTS[nearest];
}

export interface TaxRates {
  /** Your top federal bracket, e.g. 0.22. */
  federalMarginalRate: number;
  /** State income tax rate, e.g. 0.05. 0 for states without one. */
  stateIncomeRate: number;
  /** Take the 20% qualified business income deduction. */
  qbiDeduction: boolean;
}

export interface TaxEstimate {
  netProfit: number;
  selfEmploymentTax: number;
  federalIncomeTax: number;
  stateIncomeTax: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function selfEmploymentTax(netProfit: number, year: number): number {
  const base = netProfit * 0.9235;
  if (base < 400) return 0;
  const { ssWageBase } = yearConstants(year);
  return round2(Math.min(base, ssWageBase) * 0.124 + base * 0.029);
}

export function estimateTaxes(netProfit: number, year: number, rates: TaxRates): TaxEstimate {
  if (netProfit <= 0) {
    return { netProfit: round2(netProfit), selfEmploymentTax: 0, federalIncomeTax: 0, stateIncomeTax: 0, total: 0 };
  }
  const se = selfEmploymentTax(netProfit, year);
  const agiPortion = netProfit - se / 2;
  const qbi = rates.qbiDeduction ? agiPortion * 0.2 : 0;
  const federal = round2(Math.max(0, agiPortion - qbi) * rates.federalMarginalRate);
  const state = round2(Math.max(0, agiPortion) * rates.stateIncomeRate);
  return {
    netProfit: round2(netProfit),
    selfEmploymentTax: se,
    federalIncomeTax: federal,
    stateIncomeTax: state,
    total: round2(se + federal + state),
  };
}
