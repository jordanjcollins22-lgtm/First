/**
 * What a typical sale is worth, and what the commission on it costs.
 *
 * The commission screens answer "what does this job owe" one job at a time,
 * which is the right question when paying somebody and the wrong one when
 * working out whether the business can afford another account manager. That
 * question is about a month, not a job: how many sales a month, how big they
 * are, and what lands as a commission bill because of them.
 *
 * Everything here comes off the same lines the per-job screens use, so the
 * forecast and the payout can never disagree about what a job earned.
 *
 * Two deliberate choices about which money counts.
 *
 * Commission is earned on what was collected, not on what was quoted, so the
 * average sale here is the average of money that actually arrived. It will
 * read lower than the average proposal, and that gap is real: it is the jobs
 * that were trimmed, discounted, or are still half paid.
 *
 * And a month is dated by when the job finished rather than when a cheque
 * cleared, because that is when the obligation was incurred. A job finished
 * in March that pays in May still made March expensive.
 */

export interface CommissionSale {
  jobId: string;
  /** Money actually in against this job. */
  collected: number;
  /** What the rate says the job has earned in total. */
  earnedTotal: number;
  /** What has already been handed over. */
  paidOut: number;
  /** Null while the job is still running. */
  completedAt: string | null;
  /** The rate on the person whose book it is. */
  pct: number;
}

export interface SalesShape {
  /** Finished jobs with money against them. */
  jobs: number;
  collected: number;
  /** The mean. Pulled up by one big job, which is why the median is beside it. */
  averageSale: number;
  /** The middle sale. Usually the more useful of the two. */
  medianSale: number;
  /** Finished jobs a month. */
  jobsPerMonth: number;
  /** Money collected a month on finished work. */
  salesPerMonth: number;
  /** Months of finished work this is based on. */
  months: number;
}

export interface CommissionMonth {
  /** YYYY-MM. */
  month: string;
  jobs: number;
  collected: number;
  /** What the rate earned on that month's finished work. */
  commission: number;
}

export interface CommissionForecast {
  sales: SalesShape;
  /** Newest last, so it reads as a run of months. */
  months: CommissionMonth[];
  /**
   * What a month of commission typically costs.
   *
   * The median of the months rather than the mean, because one exceptional
   * month should not become the number a hiring decision is made against.
   */
  typicalMonthly: number;
  /** The average month, for comparison. A long way from the median means the
   * months are lumpy and neither figure is a promise. */
  averageMonthly: number;
  /** The rate actually being paid across the book, weighted by money. */
  blendedPct: number;
  /** What one more sale of average size costs in commission. */
  perAverageSale: number;
  /** Owed and not yet handed over, on finished work. */
  outstanding: number;
  /** Commission building up on jobs still running. Not owed yet, and coming. */
  accruing: number;
}

/**
 * What the quotes say, for a business that has not recorded any money yet.
 *
 * Kept apart from everything above and named differently on purpose. A
 * proposal is a hope, an invoice is a claim, and only a payment is money --
 * commission is paid on the last of the three. But a business with twenty-one
 * proposals and no recorded payments is not a business with no information
 * about its own average sale, and showing it nothing would be the less useful
 * lie.
 *
 * So it is offered as what it is: what a job is quoted at, and what the
 * commission on one would be if all of it came in. It never will -- jobs get
 * trimmed and discounted -- so this is the ceiling, not the forecast.
 */
export interface QuotedShape {
  proposals: number;
  averageQuote: number;
  medianQuote: number;
  /** Commission on an average quote, if every dollar of it were collected. */
  commissionPerQuote: number;
}

export function quotedShape(totals: readonly number[], pct: number): QuotedShape {
  const real = totals.filter((total) => Number.isFinite(total) && total > 0);
  const average = real.length > 0 ? round(real.reduce((sum, t) => sum + t, 0) / real.length) : 0;
  return {
    proposals: real.length,
    averageQuote: average,
    medianQuote: middle(real),
    commissionPerQuote: round((average * pct) / 100),
  };
}

/** Days a month, averaged over a year. */
const DAYS_PER_MONTH = 30.44;

/**
 * What a month of commission costs, from the book.
 *
 * Jobs with nothing collected are left out of the average sale and kept in
 * the month counts: a finished job that has not paid is a real job and a real
 * hole, and averaging it in as a zero would say the sales are half the size
 * they are.
 */
export function forecastCommission(sales: readonly CommissionSale[]): CommissionForecast {
  const finished = sales.filter((sale) => sale.completedAt != null);
  const paying = finished.filter((sale) => sale.collected > 0);

  const collected = round(paying.reduce((sum, sale) => sum + sale.collected, 0));
  const earned = round(finished.reduce((sum, sale) => sum + sale.earnedTotal, 0));
  const months = monthsBetween(finished.map((sale) => sale.completedAt!));

  const byMonth = new Map<string, CommissionMonth>();
  for (const sale of finished) {
    const month = sale.completedAt!.slice(0, 7);
    const found = byMonth.get(month) ?? { month, jobs: 0, collected: 0, commission: 0 };
    found.jobs += 1;
    found.collected = round(found.collected + sale.collected);
    found.commission = round(found.commission + sale.earnedTotal);
    byMonth.set(month, found);
  }
  const monthRows = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  const amounts = paying.map((sale) => sale.collected);
  const perMonth = months > 0 ? months : 1;

  return {
    sales: {
      jobs: paying.length,
      collected,
      averageSale: paying.length > 0 ? round(collected / paying.length) : 0,
      medianSale: middle(amounts),
      jobsPerMonth: round(finished.length / perMonth),
      salesPerMonth: round(collected / perMonth),
      months: Math.round(perMonth * 10) / 10,
    },
    months: monthRows,
    typicalMonthly: middle(monthRows.map((row) => row.commission)),
    averageMonthly: round(earned / perMonth),
    blendedPct: collected > 0 ? Math.round((earned / collected) * 1_000) / 10 : 0,
    perAverageSale: blendedOnAverage(paying, collected, earned),
    outstanding: round(
      finished.reduce((sum, sale) => sum + Math.max(0, sale.earnedTotal - sale.paidOut), 0)
    ),
    accruing: round(
      sales
        .filter((sale) => sale.completedAt == null)
        .reduce((sum, sale) => sum + Math.max(0, sale.earnedTotal - sale.paidOut), 0)
    ),
  };
}

/** What the next sale of average size will cost, at the rate actually paid. */
function blendedOnAverage(
  paying: readonly CommissionSale[],
  collected: number,
  earned: number
): number {
  if (paying.length === 0 || collected <= 0) return 0;
  return round((collected / paying.length) * (earned / collected));
}

/**
 * Months of trading between the first and last of these days.
 *
 * The span rather than a count of calendar months: three jobs across the end
 * of March and the start of April are six weeks of work, not two months of
 * it, and calling it two halves the rate.
 */
export function monthsBetween(days: readonly string[]): number {
  if (days.length === 0) return 0;
  let first = days[0];
  let last = days[0];
  for (const day of days) {
    if (day < first) first = day;
    if (day > last) last = day;
  }
  const span = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  // A single month of trading is the floor. Two jobs a week apart is not a
  // rate of eight jobs a month, it is two jobs and not enough history.
  return Math.max(span / DAYS_PER_MONTH, 1);
}

/** The middle one, which one outlier cannot move. */
function middle(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return round(
    sorted.length % 2 === 0 ? (sorted[half - 1] + sorted[half]) / 2 : sorted[half]
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
