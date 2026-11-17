/**
 * What a material really costs the business, for pricing.
 *
 * A material's own cost is the owner's figure and wins when it is set. Where
 * it isn't (a material kept for its coverage, with the price left blank),
 * the business's supplier price list says what it costs: the bulk mulch,
 * topsoil and stone the suppliers sell, priced and dated. Without this a
 * mulch bed priced with no mulch in it, at a fraction of its cost.
 *
 * Pure, so it is tested without a database.
 */

/** One product off a supplier's price list. */
export interface ListedProduct {
  /** The supplier list's kind: mulch, topsoil, stone, compost, sand, other. */
  kind: string;
  name: string;
  unit: string;
  priceCents: number | null;
  /** With delivery, where the supplier quotes it that way. */
  deliveredPriceCents: number | null;
  active: boolean;
  preferred: boolean;
  /** The material this product is set as the source for, if any. */
  materialId: string | null;
  supplier: string | null;
}

export interface MaterialCost {
  /** Dollars per the material's unit, as materials.cost_per_unit holds it. */
  perUnit: number;
  /** Where it came from, in words, e.g. "Lehnhoff's Supply, Dyed black mulch, $42/yd". */
  from: string;
}

/** The units a price list and a material can share, so a price per ton is never put on a yard. */
function unitKey(unit: string): string | null {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  if (/^(cu\.? ?)?(yd|yds|yard|yards)$|^cubic ?yards?$|^cy$/.test(u)) return "yd";
  if (/^tons?$/.test(u)) return "ton";
  if (/^(lb|lbs|pounds?)$/.test(u)) return "lb";
  if (/^bags?$/.test(u)) return "bag";
  return null;
}

/** The price list kind a material is, by its name. */
export function kindOfMaterial(name: string): string | null {
  const n = name.toLowerCase();
  if (/mulch/.test(n)) return "mulch";
  if (/top ?soil/.test(n)) return "topsoil";
  if (/compost/.test(n)) return "compost";
  if (/sand/.test(n)) return "sand";
  if (/stone|gravel|rock|rounds/.test(n)) return "stone";
  return null;
}

const priceOf = (p: ListedProduct) => p.priceCents ?? p.deliveredPriceCents;

/**
 * The cost a material is priced at: its own when set, else the supplier
 * list's for the same thing in the same unit. From the list: a product set
 * as this material's source first, then any of the same kind; the preferred
 * one if there is one, else the dearest, so a margin is never worked out on
 * a price the business might not get. Null when nothing says.
 */
export function materialCost(
  material: { id: string; name: string; unit: string; cost_per_unit: number | null },
  products: ListedProduct[]
): MaterialCost | null {
  const own = material.cost_per_unit == null ? null : Number(material.cost_per_unit);
  if (own != null && own > 0) return { perUnit: own, from: "your materials list" };
  const unit = unitKey(material.unit);
  if (!unit) return null;
  const usable = products.filter((p) => p.active && (priceOf(p) ?? 0) > 0 && unitKey(p.unit) === unit);
  const linked = usable.filter((p) => p.materialId === material.id);
  const kind = kindOfMaterial(material.name);
  const pool = linked.length > 0 ? linked : kind ? usable.filter((p) => p.kind === kind) : [];
  if (pool.length === 0) return null;
  const pick = pool.find((p) => p.preferred) ?? [...pool].sort((a, b) => priceOf(b)! - priceOf(a)!)[0];
  const cents = priceOf(pick)!;
  const dollars = cents / 100;
  return {
    perUnit: dollars,
    from: `${pick.supplier ? `${pick.supplier}, ` : ""}${pick.name}, $${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}/${pick.unit}`,
  };
}

/**
 * Materials with their real costs filled in, for pricing. A material whose
 * own cost is set is left as it is.
 */
export function withRealCosts<M extends { id: string; name: string; unit: string; cost_per_unit: number | null }>(
  materials: M[],
  products: ListedProduct[]
): (M & { cost_from?: string })[] {
  return materials.map((m) => {
    if (m.cost_per_unit != null && Number(m.cost_per_unit) > 0) return m;
    const cost = materialCost(m, products);
    return cost ? { ...m, cost_per_unit: cost.perUnit, cost_from: cost.from } : m;
  });
}
