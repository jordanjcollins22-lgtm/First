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

/** Minutes to do one sq ft, turned into a labor cost using the business's blended crew $/hour. */
export function laborCostPerSqFt(minutesPerSqft: number, crewCostPerHour: number): number {
  return (minutesPerSqft / 60) * crewCostPerHour;
}
