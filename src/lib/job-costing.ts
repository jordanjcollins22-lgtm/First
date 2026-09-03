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
   * This is the whole margin, not a margin percentage: it covers overhead,
   * the vehicles, the office and the profit.
   */
  multiplier: number;
  /**
   * A further percentage on top, applied after the multiplier.
   *
   * Separate from the multiplier because the business states it separately --
   * "times two, plus ten percent" -- and folding it in would leave a single
   * 2.2 that nobody could recognise as their own pricing, or correct without
   * doing arithmetic first.
   */
  upliftPercent: number;
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
  /** What the uplift added, on top of the multiplied figure. */
  upliftCents: number;
  /** What the client is quoted. */
  priceCents: number;
}

/**
 * Direct cost and price for one work area.
 *
 * The order matters and is the business's own: cost, then multiply, then add
 * the uplift to the multiplied figure. "Times two plus ten percent" is 2.2
 * times cost, not 2.1 -- the ten percent is charged on the marked-up number,
 * not on the raw cost. Two ways to read one sentence and a tenth of the
 * margin between them, which is why it is written down here.
 */
export function priceZone(input: ZoneCostInput, markup: Markup): ZoneCost {
  const materialsCents = Math.max(0, Math.round(input.materialsCents));
  const labourCents = Math.max(0, Math.round(input.crewHours * input.crewCostPerHourCents));
  const directCostCents = materialsCents + labourCents;

  const multiplied = directCostCents * markup.multiplier;
  const uplifted = multiplied * (1 + markup.upliftPercent / 100);

  // Rounded once, at the end. Rounding each step compounds the error into
  // something that shows up as a dollar or two on a large job.
  const priceCents = Math.round(uplifted);
  const marginCents = Math.round(multiplied) - directCostCents;

  return {
    materialsCents,
    labourCents,
    directCostCents,
    marginCents,
    upliftCents: priceCents - directCostCents - marginCents,
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
      upliftCents: total.upliftCents + zone.upliftCents,
      priceCents: total.priceCents + zone.priceCents,
    }),
    {
      materialsCents: 0,
      labourCents: 0,
      directCostCents: 0,
      marginCents: 0,
      upliftCents: 0,
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
  return markup.multiplier * (1 + markup.upliftPercent / 100);
}
