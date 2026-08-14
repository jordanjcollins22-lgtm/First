/**
 * COGS -> price: 50% gross margin means price = COGS ÷ 0.5 = COGS × 2,
 * then a flat 10% buffer on top of that price.
 */
export function priceFromCogs(cogs: number): number {
  return Math.round(cogs * 2 * 1.1 * 100) / 100;
}
