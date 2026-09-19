/**
 * Whether an address is somewhere we actually work.
 *
 * "Our market is Harford County" is a sentence everybody in the business knows
 * and nothing in the app did — so a bought list or a CRM export lands with
 * Baltimore, Cecil and half of Pennsylvania mixed in, and the only way to tell
 * was for somebody to recognise the town.
 *
 * Out of market is emphatically not a reason to delete somebody. It is a
 * reason to ask them who they know: the person on the wrong side of the county
 * line still has a cousin on the right side of it. So this marks rather than
 * filters, and every screen that shows the mark says what it is for.
 */

export interface TargetMarket {
  id: string;
  name: string;
  zips: string[];
  cities: string[];
  counties: string[];
  active: boolean;
}

export interface AddressParts {
  /** The full address line, used as a fallback when the parts are empty. */
  address: string | null;
  city: string | null;
  zip: string | null;
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Five digits, so a ZIP+4 matches a plain one. */
function zipOf(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(/\d{5}/);
  return match ? match[0] : null;
}

export type MarketVerdict =
  | { known: true; inMarket: true; market: TargetMarket; matchedOn: "zip" | "city" | "county" }
  | { known: true; inMarket: false }
  | { known: false };

/**
 * Which market an address falls in, if any.
 *
 * Checked most reliable first. A zip is exact. A town name is nearly exact,
 * and matched against the whole address as well as the city column because
 * imports routinely leave the city blank and put everything on one line. A
 * county name only appears in some addresses at all, so it is last.
 *
 * Returns "not known" rather than "out of market" when there is nothing to go
 * on. Marking somebody as outside our area because their address was blank is
 * a worse mistake than not marking them, and it is the one that would quietly
 * take a whole import out of the calling list.
 */
export function marketFor(parts: AddressParts, markets: TargetMarket[]): MarketVerdict {
  const active = markets.filter((m) => m.active);
  // With nothing configured, everywhere is our market. The alternative is an
  // app that declares every contact out of area the day it is installed.
  if (active.length === 0) return { known: false };

  const zip = zipOf(parts.zip) ?? zipOf(parts.address);
  const city = normalise(parts.city);
  const line = normalise(parts.address);
  // Addresses are comma-separated and the town is a whole segment of one.
  // That distinction is the only thing separating Street, the town in Harford
  // County, from Street, the last word of half the addresses ever written.
  const segments = line
    .split(",")
    .map((part) => normalise(part))
    .filter((part) => part.length > 0);

  if (!zip && !city && !line) return { known: false };

  for (const market of active) {
    if (zip && market.zips.some((z) => zipOf(z) === zip)) {
      return { known: true, inMarket: true, market, matchedOn: "zip" };
    }
  }

  for (const market of active) {
    const hit = market.cities.some((c) => {
      const name = normalise(c);
      if (!name) return false;
      if (city && city === name) return true;
      // A whole segment, never a substring of one. "14 Main Street" is a
      // street; "…, Street, MD" is a town.
      return segments.includes(name);
    });
    if (hit) return { known: true, inMarket: true, market, matchedOn: "city" };
  }

  for (const market of active) {
    const hit = market.counties.some((c) => {
      const name = normalise(c);
      return name.length > 0 && line.includes(name);
    });
    if (hit) return { known: true, inMarket: true, market, matchedOn: "county" };
  }

  // Something to go on, and none of it matched.
  return { known: true, inMarket: false };
}

export interface MarketTally {
  inMarket: number;
  outOfMarket: number;
  unknown: number;
}

export function tallyMarkets(
  rows: AddressParts[],
  markets: TargetMarket[]
): MarketTally {
  const tally: MarketTally = { inMarket: 0, outOfMarket: 0, unknown: 0 };
  for (const row of rows) {
    const verdict = marketFor(row, markets);
    if (!verdict.known) tally.unknown++;
    else if (verdict.inMarket) tally.inMarket++;
    else tally.outOfMarket++;
  }
  return tally;
}

/** The line under the count. Out of market is an opportunity, and a screen
 * that says so is the difference between calling them and deleting them. */
export function describeTally(tally: MarketTally): string {
  if (tally.inMarket + tally.outOfMarket === 0) {
    return "Nothing has been checked against a market yet.";
  }
  if (tally.outOfMarket === 0) return "Everything checked is inside our market.";
  return `${tally.outOfMarket.toLocaleString()} outside our market — still worth a call to ask who they know.`;
}
