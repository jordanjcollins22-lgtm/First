/**
 * Rule-of-thumb material coverage rates, used to turn a zone's real square
 * footage into an order quantity. These are reasonable defaults, not your
 * real specs — swap the numbers below for your actual coverage rates.
 */
export interface MaterialFormula {
  material: string;
  unit: string;
  /** Square feet covered by one unit at the assumed application depth. */
  coveragePerUnitSqFt: number;
  wasteFactorPct: number;
}

const MULCH: MaterialFormula = { material: "Mulch", unit: "cubic yards", coveragePerUnitSqFt: 100, wasteFactorPct: 10 };
const ROCK: MaterialFormula = { material: "Rock", unit: "cubic yards", coveragePerUnitSqFt: 80, wasteFactorPct: 10 };
const TOPSOIL: MaterialFormula = { material: "Topsoil", unit: "cubic yards", coveragePerUnitSqFt: 110, wasteFactorPct: 10 };
// ~5 lb of grass seed per 1,000 sq ft is a common baseline rate.
const GRASS_SEED: MaterialFormula = { material: "Grass seed", unit: "lb", coveragePerUnitSqFt: 200, wasteFactorPct: 5 };

const CUBIC_FEET_PER_YARD = 27;
// Typical loaded wheelbarrow capacity used for hauling estimates.
const WHEELBARROW_CUBIC_FEET = 3;

export interface MaterialLineItem {
  zoneId: string;
  zoneName: string;
  material: string;
  quantity: number;
  unit: string;
  wheelbarrowLoads: number | null;
}

function addFormula(
  items: MaterialLineItem[],
  zoneId: string,
  zoneName: string,
  areaSqFt: number,
  formula: MaterialFormula
) {
  const rawUnits = areaSqFt / formula.coveragePerUnitSqFt;
  const quantity = rawUnits * (1 + formula.wasteFactorPct / 100);
  const wheelbarrowLoads =
    formula.unit === "cubic yards" ? Math.ceil((quantity * CUBIC_FEET_PER_YARD) / WHEELBARROW_CUBIC_FEET) : null;
  items.push({ zoneId, zoneName, material: formula.material, quantity, unit: formula.unit, wheelbarrowLoads });
}

export function zoneMaterialLineItems(
  zoneId: string,
  zoneName: string,
  serviceTypeId: string,
  values: Record<string, string>,
  areaSqFt: number
): MaterialLineItem[] {
  const items: MaterialLineItem[] = [];

  if (serviceTypeId === "landscape-bed") {
    if (values.material === "Mulch") addFormula(items, zoneId, zoneName, areaSqFt, MULCH);
    else if (values.material === "Rock") addFormula(items, zoneId, zoneName, areaSqFt, ROCK);
  } else if (serviceTypeId === "lawn-restoration") {
    if (values.soilCondition === "Needs Topsoil") addFormula(items, zoneId, zoneName, areaSqFt, TOPSOIL);
    addFormula(items, zoneId, zoneName, areaSqFt, GRASS_SEED);
  } else if (serviceTypeId === "grading" && values.purpose === "Landscape-to-Lawn") {
    addFormula(items, zoneId, zoneName, areaSqFt, TOPSOIL);
  }

  return items;
}

export function formatMaterialQuantity(item: MaterialLineItem): string {
  const qty = item.quantity < 10 ? item.quantity.toFixed(1) : Math.round(item.quantity).toLocaleString();
  const base = `${qty} ${item.unit}`;
  return item.wheelbarrowLoads ? `${base} (≈${item.wheelbarrowLoads} wheelbarrow loads)` : base;
}
