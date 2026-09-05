/**
 * Which hanger goes on which door, and how many of each to print.
 *
 * The business puts hangers out around every evaluation and every job, so the
 * neighbours of somebody who just bought see the work. A door that has never
 * had one gets the introduction. A door that has had one already gets the next
 * design, which can say something the first could not -- that we are back on
 * this street, that we have now done two gardens on it.
 *
 * That escalation is the whole idea, and it only works if the count belongs to
 * the house rather than to the area walked. Areas get redrawn; a street that
 * fell in two zones would otherwise be introduced to twice.
 *
 * Kept pure and apart from the database because it decides what gets printed,
 * and a print run is the one thing here that cannot be undone after the fact.
 */

export interface HouseVisit {
  houseId: string;
  /** How many hangers this door has already had. Zero for a new house. */
  hangCount: number;
}

export interface PrintLine {
  /** 1 is the introduction. */
  design: number;
  /** How many of it to print. */
  count: number;
}

/**
 * The design a door gets next.
 *
 * Escalates by one per hanger already delivered, and then stops at the last
 * design that exists rather than asking for a fifth that was never drawn. A
 * street we have walked five times keeps getting the last thing we wrote,
 * which is a reasonable thing to say twice and better than printing nothing.
 *
 * There is always a design 1. A business with no artwork uploaded still has
 * something to hand somebody, and refusing to number the run would stop the
 * walk over a missing file.
 */
export function nextDesign(hangCount: number, designsAvailable: number): number {
  const designs = Math.max(1, Math.floor(designsAvailable));
  const visits = Math.max(0, Math.floor(hangCount));
  return Math.min(visits + 1, designs);
}

/**
 * What to print for a walk, from the doors it covers.
 *
 * Ordered by design so the run reads as a stack to be printed, and lines with
 * nothing in them are left out rather than printed as zero -- a zero on a
 * print sheet is read as a mistake by whoever is standing at the printer.
 */
export function printRun(houses: HouseVisit[], designsAvailable: number): PrintLine[] {
  const counts = new Map<number, number>();
  for (const house of houses) {
    const design = nextDesign(house.hangCount, designsAvailable);
    counts.set(design, (counts.get(design) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([design, count]) => ({ design, count }))
    .sort((a, b) => a.design - b.design);
}

/** How many hangers the walk needs in total: one per door. */
export function totalToPrint(houses: HouseVisit[]): number {
  return houses.length;
}

/**
 * How many of these doors have never had a hanger.
 *
 * The number worth reading before a walk. A route that is all introductions is
 * new ground; one that is all repeats is a street being worked, and the two
 * are different conversations to have with the person walking it.
 */
export function firstTimeDoors(houses: HouseVisit[]): number {
  return houses.filter((house) => house.hangCount === 0).length;
}
