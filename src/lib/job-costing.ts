/**
 * What a zone costs us, and what we charge for it.
 *
 * The business prices from the bottom up: work out what the job costs to do,
 * then mark it up. Every input already exists elsewhere in the app -- the
 * materials a service needs come off its material rules and the inventory's
 * unit costs, and the hours come off its timing and the measurement the
 * evaluator took. What was missing was the arithmetic that turns those into a
 * number, and somewhere to keep the two multipliers.
 *
 * Kept apart from where the inputs come from on purpose. Gathering them means
 * a catalog, an organization and a saved design; the sum is four lines of
 * arithmetic that decides every price this business quotes, and it should be
 * possible to read it, and test it, without any of that.
 *
 * Money is in whole cents throughout. A price built from a per-unit material
 * cost times a fractional quantity times a markup is several floating point
 * multiplications deep, and dollars-as-floats drift far enough to make two
 * ways of totalling the same job disagree by a cent -- which is the kind of
 * thing a client notices on an invoice and nobody can explain.
 */

export interface Markup {
  /**
   * What direct cost is multiplied by. 2 doubles it.
   *
   * A multiplier on cost rather than a margin percentage, because that is how
   * the business quotes: "materials and labour, times two".
   */
  multiplier: number;
  /**
   * Overhead, as a percentage added at the end.
   *
   * Added after the multiplier, not to the raw cost: it is charged on the
   * marked-up figure, which makes "times two plus ten percent" 2.2x cost and
   * not 2.1x. Kept as its own number rather than folded into a single 2.2,
   * because the business thinks of it as overhead rather than margin, and a
   * lone 2.2 is neither recognisable as their own pricing nor correctable
   * without doing arithmetic first.
   */
  overheadPercent: number;
}

export interface ZoneCostInput {
  /** What the materials for this zone cost us, in cents. */
  materialsCents: number;
  /**
   * Crew-hours, not clock-hours. A three-person crew for one hour is three.
   */
  crewHours: number;
  /** What one crew-hour costs us, in cents. */
  crewCostPerHourCents: number;
}

export interface ZoneCost {
  materialsCents: number;
  labourCents: number;
  /** Materials and labour: what it costs us before any markup. */
  directCostCents: number;
  /** What the multiplier added. */
  marginCents: number;
  /** What the overhead added, on top of the multiplied figure. */
  overheadCents: number;
  /** What the client is quoted. */
  priceCents: number;
}

/**
 * Direct cost and price for one work area.
 *
 * The order matters and is the business's own: cost, then multiply, then add
 * the overhead to the multiplied figure. "Times two plus ten percent" is 2.2
 * times cost, not 2.1 -- the ten percent is charged on the marked-up number,
 * not on the raw cost. Two ways to read one sentence and a tenth of the
 * margin between them, which is why it is written down here.
 */
export function priceZone(input: ZoneCostInput, markup: Markup): ZoneCost {
  const materialsCents = Math.max(0, Math.round(input.materialsCents));
  const labourCents = Math.max(0, Math.round(input.crewHours * input.crewCostPerHourCents));
  const directCostCents = materialsCents + labourCents;

  const multiplied = directCostCents * markup.multiplier;
  const withOverhead = multiplied * (1 + markup.overheadPercent / 100);

  // Rounded once, at the end. Rounding each step compounds the error into
  // something that shows up as a dollar or two on a large job.
  const priceCents = Math.round(withOverhead);
  const marginCents = Math.round(multiplied) - directCostCents;

  return {
    materialsCents,
    labourCents,
    directCostCents,
    marginCents,
    overheadCents: priceCents - directCostCents - marginCents,
    priceCents,
  };
}

/**
 * The job, from its zones.
 *
 * Summed from the per-zone prices rather than priced from summed costs. The
 * two agree today, and would stop agreeing the moment one zone is priced by
 * hand or a service carries its own markup -- and it is the per-zone numbers
 * that get shown, argued about, and dropped from the quote when a client
 * trims the job.
 */
export function priceJob(zones: ZoneCost[]): ZoneCost {
  return zones.reduce<ZoneCost>(
    (total, zone) => ({
      materialsCents: total.materialsCents + zone.materialsCents,
      labourCents: total.labourCents + zone.labourCents,
      directCostCents: total.directCostCents + zone.directCostCents,
      marginCents: total.marginCents + zone.marginCents,
      overheadCents: total.overheadCents + zone.overheadCents,
      priceCents: total.priceCents + zone.priceCents,
    }),
    {
      materialsCents: 0,
      labourCents: 0,
      directCostCents: 0,
      marginCents: 0,
      overheadCents: 0,
      priceCents: 0,
    }
  );
}

/**
 * What the account manager reads: the markup as a single number.
 *
 * Shown rather than the two settings, because "2.2x" is the question being
 * asked when somebody looks at a price and wonders whether it is right.
 */
export function effectiveMultiplier(markup: Markup): number {
  return markup.multiplier * (1 + markup.overheadPercent / 100);
}

/**
 * What an hour of crew time costs, in whole cents.
 *
 * Blended from the hourly team's actual pay rates. Commission pay is a share
 * of the sale rather than a cost per hour, so those people are not in the
 * average -- including them would drag the rate towards zero and quietly
 * underprice every job.
 *
 * The organization's own figure is a fallback for a business that has not
 * entered anybody's pay yet, not an override. Once there are real rates they
 * are the truth, and a stale manual number that disagreed with the payroll
 * would be the more convincing of the two on screen.
 *
 * Shared rather than written twice: the Team page shows this number and the
 * quote is built from it, and two copies of an average are two numbers that
 * eventually disagree in front of a client.
 */
export function blendedCrewRateCents(
  team: { payType: string; ratePerHour: number | null }[],
  fallbackPerHour: number | null
): number {
  const hourly = team
    .filter((member) => member.payType !== "commission")
    .map((member) => member.ratePerHour)
    .filter((rate): rate is number => rate != null);

  if (hourly.length > 0) {
    return Math.round((hourly.reduce((sum, rate) => sum + rate, 0) / hourly.length) * 100);
  }
  return Math.round((fallbackPerHour ?? 0) * 100);
}
