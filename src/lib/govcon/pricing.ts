/**
 * Bid pricing for the broker model: sub quote + markup, sanity-checked
 * against what the government paid last time (USAspending) and the Service
 * Contract Act labor floor when we know it.
 */
export interface PriceAnchor {
  /** Annualized prior award amount for the same requirement. */
  annualAmount: number;
  source: string; // e.g. "USAspending 36C24623P1466 (DMRESOLUTIONS LLC)"
}

export interface PricingInput {
  subQuote: number;
  targetMarkup: number;
  minMarkup: number;
  anchor?: PriceAnchor | null;
  /** Minimum labor cost under the wage determination, if estimated. */
  laborFloor?: number | null;
}

export interface PricingResult {
  price: number;
  markup: number;
  margin: number; // dollars
  rationale: string[];
  warnings: string[];
}

/** Round up to a "clean" bid number: $10 under 10k, $50 under 100k, else $100. */
export function roundBid(n: number): number {
  const step = n < 10_000 ? 10 : n < 100_000 ? 50 : 100;
  return Math.ceil((n - 1e-6) / step) * step; // epsilon: 100000 * 1.12 is 112000.00000000001
}

export function priceBid(input: PricingInput): PricingResult {
  const { subQuote, targetMarkup, minMarkup, anchor, laborFloor } = input;
  const rationale: string[] = [];
  const warnings: string[] = [];
  const target = subQuote * (1 + targetMarkup);
  const floor = subQuote * (1 + minMarkup);
  let price = target;
  rationale.push(`Sub quote $${subQuote.toLocaleString()} + ${Math.round(targetMarkup * 100)}% target markup = $${Math.round(target).toLocaleString()}`);

  if (anchor) {
    // Stay a little under what the incumbent was paid, if margin allows.
    const ceiling = anchor.annualAmount * 0.97;
    if (target <= ceiling) {
      rationale.push(`Under the prior award ($${Math.round(anchor.annualAmount).toLocaleString()}/yr, ${anchor.source}) — target price holds`);
    } else if (floor <= ceiling) {
      price = ceiling;
      rationale.push(`Trimmed to 97% of the prior award ($${Math.round(anchor.annualAmount).toLocaleString()}/yr) to stay competitive`);
    } else {
      price = floor;
      warnings.push(
        `Even at the ${Math.round(minMarkup * 100)}% minimum markup we're ${Math.round((floor / anchor.annualAmount - 1) * 100)}% above the prior award — get more sub quotes or no-bid`
      );
    }
  }

  if (laborFloor && subQuote < laborFloor) {
    warnings.push(
      `Sub quote is below the estimated SCA labor floor ($${Math.round(laborFloor).toLocaleString()}) — the sub may not be paying wage-determination rates, and the prime is jointly liable`
    );
  }

  price = roundBid(price);
  const margin = price - subQuote;
  return { price, markup: margin / subQuote, margin, rationale, warnings };
}
