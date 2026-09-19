/**
 * What the work actually takes, measured against what it was quoted at.
 *
 * Every price, every schedule and every profit figure in this app rests on one
 * number per service: how long it takes. That number was typed in by somebody
 * once. Meanwhile the crew has been clocking on and off jobs for months, which
 * means the true answer has been sitting in the database the whole time and
 * nothing was reading it.
 *
 * This reads it. There is no model, no learning rate and nothing that improves
 * quietly overnight: it is a ratio of measured hours to quoted hours, taken as
 * a median over the jobs that finished, and it is shown to a person who decides
 * whether to change the estimate. That is the whole of it, and it is deliberate
 * -- a pricing model nobody can explain is a pricing model nobody will defend
 * to a client.
 *
 * Three things it refuses to do.
 *
 * **It will not speak from too few jobs.** Four jobs is an anecdote. Below the
 * threshold it says how many more it needs rather than showing a number that
 * looks like an answer.
 *
 * **It uses the median, not the mean.** One job where the van broke down and
 * one where a client kept the crew talking for two hours would drag an average
 * somewhere useless. The median is what a typical job of this kind actually
 * costs, which is the question being asked.
 *
 * **It never applies itself.** It suggests a number and says what it is based
 * on. Somebody with the authority to change what the business charges makes
 * the change.
 */

export interface WorkSample {
  jobId: string;
  serviceTypeId: string;
  /** Crew-hours the job was quoted at, from the same function that priced it. */
  quotedHours: number;
  /** Crew-hours actually clocked, summed over everybody on the job. */
  actualHours: number;
  completedAt: string;
}

/** Below this many finished jobs, a service has an anecdote rather than a rate. */
export const ENOUGH_JOBS = 5;

/** Inside this band the quote is right, and fiddling with it is noise. */
export const CLOSE_ENOUGH = 0.15;

export type Verdict = "not_enough" | "about_right" | "under_quoted" | "over_quoted";

export interface ServiceCalibration {
  serviceTypeId: string;
  jobs: number;
  /** Median of actual ÷ quoted. Null when there is not enough to say. */
  ratio: number | null;
  quotedMedianHours: number | null;
  actualMedianHours: number | null;
  verdict: Verdict;
  /** What to change the estimate to, when there is a case for changing it. */
  suggestedHours: number | null;
  /** One sentence, with the evidence in it. */
  says: string;
}

/** The middle value. Even counts take the mean of the two in the middle. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How one service's quoted time compares with the time it takes.
 *
 * Samples with a quote of zero are dropped rather than counted as infinitely
 * under-quoted: a service with no timing has nothing to calibrate, and it is
 * the timing that needs setting, not correcting.
 */
export function calibrateService(serviceTypeId: string, samples: readonly WorkSample[]): ServiceCalibration {
  const usable = samples.filter(
    (s) => s.serviceTypeId === serviceTypeId && s.quotedHours > 0 && s.actualHours > 0
  );

  if (usable.length < ENOUGH_JOBS) {
    const needed = ENOUGH_JOBS - usable.length;
    return {
      serviceTypeId,
      jobs: usable.length,
      ratio: null,
      quotedMedianHours: null,
      actualMedianHours: null,
      verdict: "not_enough",
      suggestedHours: null,
      says:
        usable.length === 0
          ? "No finished job with clocked time yet, so there is nothing to compare the quote against."
          : `${usable.length} finished ${usable.length === 1 ? "job" : "jobs"} with clocked time. ${needed} more and this can be answered.`,
    };
  }

  const ratio = median(usable.map((s) => s.actualHours / s.quotedHours))!;
  const quotedMedian = median(usable.map((s) => s.quotedHours))!;
  const actualMedian = median(usable.map((s) => s.actualHours))!;

  if (Math.abs(ratio - 1) <= CLOSE_ENOUGH) {
    return {
      serviceTypeId,
      jobs: usable.length,
      ratio,
      quotedMedianHours: quotedMedian,
      actualMedianHours: actualMedian,
      verdict: "about_right",
      suggestedHours: null,
      says: `The quote holds up: ${usable.length} finished jobs took a median ${actualMedian.toFixed(1)} crew-hours against ${quotedMedian.toFixed(1)} quoted.`,
    };
  }

  const under = ratio > 1;
  return {
    serviceTypeId,
    jobs: usable.length,
    ratio,
    quotedMedianHours: quotedMedian,
    actualMedianHours: actualMedian,
    verdict: under ? "under_quoted" : "over_quoted",
    // The suggestion is the measured median, not the ratio applied to the
    // quote. It is the number the jobs actually produced.
    suggestedHours: Math.round(actualMedian * 10) / 10,
    says: under
      ? `Under-quoted by ${Math.round((ratio - 1) * 100)}%: ${usable.length} finished jobs took a median ${actualMedian.toFixed(1)} crew-hours against ${quotedMedian.toFixed(1)} quoted.`
      : `Over-quoted by ${Math.round((1 - ratio) * 100)}%: ${usable.length} finished jobs took a median ${actualMedian.toFixed(1)} crew-hours against ${quotedMedian.toFixed(1)} quoted.`,
  };
}

export function calibrateAll(samples: readonly WorkSample[]): ServiceCalibration[] {
  const ids = [...new Set(samples.map((s) => s.serviceTypeId))];
  return ids
    .map((id) => calibrateService(id, samples))
    .sort((a, b) => {
      // The ones with a case to answer first, worst first; then the ones with
      // nothing to say, which are the ones somebody should stop looking at.
      const rank = (c: ServiceCalibration) =>
        c.verdict === "under_quoted" ? 0 : c.verdict === "over_quoted" ? 1 : c.verdict === "about_right" ? 2 : 3;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return Math.abs((b.ratio ?? 1) - 1) - Math.abs((a.ratio ?? 1) - 1);
    });
}

/**
 * What the mis-quoting is costing, per job, at a given crew cost.
 *
 * Null where there is nothing to say. Positive means the business is losing
 * money on each one; negative means it is leaving work on the table by pricing
 * itself out. Both are worth knowing and they are not the same problem.
 */
export function costOfBeingWrongCents(
  calibration: ServiceCalibration,
  crewCostPerHourCents: number | null
): number | null {
  if (calibration.ratio == null || crewCostPerHourCents == null) return null;
  if (calibration.actualMedianHours == null || calibration.quotedMedianHours == null) return null;
  return Math.round((calibration.actualMedianHours - calibration.quotedMedianHours) * crewCostPerHourCents);
}

/**
 * The one sentence for the top of the screen.
 *
 * Names the single service costing the most, because a list of fourteen
 * services each five per cent out is a list nobody acts on.
 */
export function headline(
  calibrations: readonly ServiceCalibration[],
  crewCostPerHourCents: number | null
): string {
  const answerable = calibrations.filter((c) => c.verdict === "under_quoted" || c.verdict === "over_quoted");
  if (answerable.length === 0) {
    const measured = calibrations.filter((c) => c.verdict === "about_right").length;
    return measured > 0
      ? `Every service with enough finished jobs to judge is quoted about right (${measured} of them).`
      : "Not enough finished jobs with clocked time yet to judge any service.";
  }

  const worst = [...answerable].sort((a, b) => {
    const ca = Math.abs(costOfBeingWrongCents(a, crewCostPerHourCents) ?? 0);
    const cb = Math.abs(costOfBeingWrongCents(b, crewCostPerHourCents) ?? 0);
    if (ca !== cb) return cb - ca;
    return Math.abs((b.ratio ?? 1) - 1) - Math.abs((a.ratio ?? 1) - 1);
  })[0];

  const cost = costOfBeingWrongCents(worst, crewCostPerHourCents);
  const money = cost == null ? null : `${(Math.abs(cost) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;

  if (worst.verdict === "under_quoted") {
    return money
      ? `${worst.serviceTypeId} is the one to fix: it costs about ${money} more per job than it is quoted at.`
      : `${worst.serviceTypeId} is the one to fix: it takes about ${Math.round(((worst.ratio ?? 1) - 1) * 100)}% longer than it is quoted at.`;
  }
  return money
    ? `${worst.serviceTypeId} is quoted about ${money} per job above what it takes, which may be losing work.`
    : `${worst.serviceTypeId} is quoted about ${Math.round((1 - (worst.ratio ?? 1)) * 100)}% above what it takes.`;
}
