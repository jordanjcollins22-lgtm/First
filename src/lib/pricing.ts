/**
 * COGS -> price: 50% gross margin means price = COGS ÷ 0.5 = COGS × 2,
 * then a flat 10% buffer on top of that price.
 */
export function priceFromCogs(cogs: number): number {
  return Math.round(cogs * 2 * 1.1 * 100) / 100;
}

interface MaterialLike {
  id: string;
  cost_per_unit: number | null;
  coverage_per_unit_sqft: number | null;
  waste_factor_pct: number;
}

interface MaterialRuleLike {
  service_type_id: string;
  material_id: string;
}

/** Sum of every linked material's cost to cover one sq ft, waste included. */
export function materialsCostPerSqFt(
  serviceTypeId: string,
  rules: MaterialRuleLike[],
  materials: MaterialLike[]
): number {
  let total = 0;
  for (const rule of rules) {
    if (rule.service_type_id !== serviceTypeId) continue;
    const material = materials.find((m) => m.id === rule.material_id);
    if (!material || material.cost_per_unit == null || !material.coverage_per_unit_sqft) continue;
    total += (material.cost_per_unit / material.coverage_per_unit_sqft) * (1 + material.waste_factor_pct / 100);
  }
  return total;
}

/**
 * Labor cost for one sq ft. Minutes-per-sq-ft is wall-clock time, so a crew
 * of 3 burns 3x that in paid crew-hours — hence the crewSize multiplier.
 */
export function laborCostPerSqFt(minutesPerSqft: number, crewCostPerHour: number, crewSize = 1): number {
  return (minutesPerSqft / 60) * crewCostPerHour * crewSize;
}

/** Buying a 25-pack for $18 means each unit costs $0.72 — that per-unit
 * number is what quoting multiplies by, so it's derived here rather than
 * asked for twice. A material priced directly (bulk mulch by the yard) has
 * no pack and keeps whatever was entered. */
export function derivedCostPerUnit(
  packSize: number | null,
  packCost: number | null,
  enteredCostPerUnit: number | null
): number | null {
  if (packSize != null && packCost != null && packSize > 0) {
    return Math.round((packCost / packSize) * 10000) / 10000;
  }
  return enteredCostPerUnit;
}
