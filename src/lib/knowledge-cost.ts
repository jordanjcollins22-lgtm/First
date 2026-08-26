/**
 * What an idea costs, added up from what it is made of.
 *
 * Nothing here stores a total. A total that is stored is a total that goes
 * stale the moment somebody changes the price of toner, and then the number
 * on the screen is worse than no number at all, because people believe it.
 *
 * Money and time are kept apart on purpose. Four hours of somebody's Saturday
 * and eighty dollars of cardstock are both costs, but they are not the same
 * cost, and a business that only ever sees them added together is one that
 * cannot tell "expensive" from "exhausting".
 */

import { neighboursOf, type Graph, type GraphEdge, type GraphNode } from "@/lib/knowledge-graph";

export interface UnitDef {
  value: string;
  label: string;
  /** True where one unit is a unit of somebody's time. */
  time: boolean;
  /** Hours in one of them, for adding days and hours together. */
  hours?: number;
  /** How more than one of it reads, where adding an "s" is wrong. */
  plural?: string;
}

export const UNITS: UnitDef[] = [
  { value: "each", label: "each", time: false },
  { value: "hour", label: "per hour", time: true, hours: 1 },
  { value: "day", label: "per day", time: true, hours: 8 },
  { value: "week", label: "per week", time: true, hours: 40 },
  { value: "month", label: "per month", time: false },
  { value: "sheet", label: "per sheet", time: false },
  { value: "box", label: "per box", time: false },
  { value: "pack", label: "per pack", time: false },
  { value: "bag", label: "per bag", time: false },
  { value: "roll", label: "per roll", time: false },
  { value: "gallon", label: "per gallon", time: false },
  { value: "pound", label: "per pound", time: false, plural: "lbs" },
  { value: "ton", label: "per ton", time: false },
  { value: "ft", label: "per foot", time: false, plural: "feet" },
  { value: "sq ft", label: "per sq ft", time: false, plural: "sq ft" },
  { value: "yard", label: "per yard", time: false },
  { value: "mile", label: "per mile", time: false },
  { value: "job", label: "per job", time: false },
  { value: "visit", label: "per visit", time: false },
];

const UNIT_BY_VALUE = new Map(UNITS.map((u) => [u.value, u]));

export function unitDef(value: string): UnitDef {
  return UNIT_BY_VALUE.get(value) ?? UNIT_BY_VALUE.get("each")!;
}

/** A month is deliberately not time: a monthly software bill is money, not
 * somebody's afternoon. Hours, days and weeks are the ones a person spends. */
export function isTimeUnit(value: string): boolean {
  return unitDef(value).time;
}

export interface CostLine {
  node: GraphNode;
  edge: GraphEdge;
  /** How many units, defaulting to one so an unpriced connection still
   * counts the thing once rather than counting it as nothing. */
  quantity: number;
  /** True only when every hop from the root to here said how many. A
   * quantity that defaulted to one along the way is a guess, and somewhere
   * further up something needs to say whether it is two thousand or five. */
  quantityStated: boolean;
  unitCost: number;
  amount: number;
  time: boolean;
  /** Bought once and kept, rather than consumed by this run. */
  capital: boolean;
  /** A flat price that does not multiply by the quantity — a subcontractor,
   * a permit, a delivery fee. */
  fixed: boolean;
  hours: number;
  /** How far down the breakdown this came from. Zero is directly required. */
  depth: number;
  /** The chain from the thing being costed to here, ids only. What makes it
   * possible to say "door hangers → print run → printer" rather than just
   * "the printer is in there somewhere". */
  path: string[];
}

export interface CostBreakdown {
  /** Everything consumed doing it once — paper, toner, fuel. */
  materials: number;
  /** What the time costs, where a rate has been put against it. */
  labour: number;
  hours: number;
  /** What one run costs: materials plus time. Deliberately excludes the
   * printer, because you do not buy a printer every time you print. */
  total: number;
  /** Kit it needs that is bought once and used forever. Kept out of the run
   * cost and shown on its own, otherwise a shared printer is charged to every
   * idea that touches it and the whole point of spotting a shared resource —
   * that it is one purchase — is contradicted by the number underneath it. */
  capital: number;
  capitalItems: GraphNode[];
  /** Money that goes to somebody else at a flat price. Kept apart because a
   * fixed fee behaves like neither materials nor hours: it does not scale
   * with the run and it is not somebody's afternoon. */
  services: number;
  serviceItems: GraphNode[];
  lines: CostLine[];
  /** Things in the breakdown with no price on them yet. A total that quietly
   * omits half the inputs is the most expensive kind of wrong. */
  unpriced: GraphNode[];
}

const EMPTY: CostBreakdown = {
  materials: 0,
  labour: 0,
  hours: 0,
  total: 0,
  capital: 0,
  capitalItems: [],
  services: 0,
  serviceItems: [],
  lines: [],
  unpriced: [],
};

/** Things you buy once and keep. A mower is not a cost of mowing a lawn, it
 * is a cost of being in the business of mowing lawns. */
const CAPITAL_TYPES = new Set(["equipment", "machine", "tool", "software", "asset"]);

/**
 * Whether something is charged once or charged every run.
 *
 * What somebody actually said wins over what the kind of thing implies. The
 * inference is right most of the time and wrong in the cases that cost money:
 * a sign frame is filed as a material and goes back in the truck at the end
 * of the day, and charging it to every campaign overstates all of them.
 */
export function isCapital(node: GraphNode): boolean {
  if (node.costBasis) return node.costBasis === "capital";
  return CAPITAL_TYPES.has(node.nodeType);
}

/** What the kind of thing implies, for pre-selecting the choice rather than
 * making somebody answer a question the app can already guess. */
export function defaultCostBasis(nodeType: string): "consumable" | "capital" {
  return CAPITAL_TYPES.has(nodeType) ? "capital" : "consumable";
}

/** Connections that mean "this is made of that". Pointing at something you
 * merely resemble should not add its price to your bill. */
const CONSUMING = new Set([
  "uses",
  "requires",
  "requires_material",
  "requires_equipment",
  "requires_skill",
  "depends_on",
  "performed_by",
  "has_cost",
  "part_of",
]);

/**
 * What one idea costs, all the way down.
 *
 * Recursive, because a real breakdown has layers: door hangers require a
 * print run, a print run requires cardstock and toner. Stopping at the first
 * level would give an answer of zero for anything anybody had bothered to
 * decompose properly, which is exactly backwards.
 *
 * Quantities multiply down the chain — five print runs of two thousand sheets
 * is ten thousand sheets — and a node already counted is not counted twice on
 * the same path, so a cycle cannot run forever.
 */
export function costOf(graph: Graph, nodeId: string, maxDepth = 4): CostBreakdown {
  const root = graph.nodes.find((n) => n.id === nodeId);
  if (!root) return EMPTY;

  const lines: CostLine[] = [];
  const unpriced = new Map<string, GraphNode>();

  function walk(
    id: string,
    multiplier: number,
    depth: number,
    seen: Set<string>,
    trail: string[],
    stated: boolean
  ) {
    if (depth > maxDepth) return;

    for (const { node, edge, outgoing } of neighboursOf(graph, id)) {
      // Only outgoing: "flyers require cardstock" costs the flyers something.
      // "the printer is used by flyers" does not cost the printer anything.
      if (!outgoing) continue;
      if (!CONSUMING.has(edge.relationshipType)) continue;
      if (seen.has(node.id)) continue;

      const quantity = (edge.quantity ?? 1) * multiplier;
      const quantityStated = stated && edge.quantity != null;
      const unitCost = node.estimatedCost ?? 0;
      const fixed = node.fixedCost != null;
      const capital = !fixed && isCapital(node);
      // Hours come from the unit the node actually carries, resolved when the
      // graph loaded — so a unit this business invented counts as time if
      // they said it was.
      const perUnitHours = node.unitHours ?? (isTimeUnit(node.unit) ? unitDef(node.unit).hours ?? 1 : 0);
      const time = !capital && !fixed && perUnitHours > 0;

      // A flat fee is priced by definition. Only a per-unit thing with no
      // price is a gap in the total.
      if (!fixed && node.estimatedCost == null) unpriced.set(node.id, node);

      lines.push({
        node,
        edge,
        quantity,
        quantityStated,
        unitCost,
        // A flat fee is the fee. Kit is priced at what it costs to own,
        // once, not once per run. Everything else multiplies.
        amount: fixed ? node.fixedCost! : capital ? unitCost : quantity * unitCost,
        time,
        capital,
        fixed,
        hours: time ? quantity * perUnitHours : 0,
        depth,
        path: [...trail, node.id],
      });

      walk(node.id, quantity, depth + 1, new Set([...seen, node.id]), [...trail, node.id], quantityStated);
    }
  }

  walk(nodeId, 1, 0, new Set([nodeId]), [], true);

  let materials = 0;
  let labour = 0;
  let hours = 0;
  const capitalItems = new Map<string, GraphNode>();
  const serviceItems = new Map<string, GraphNode>();
  let capital = 0;
  let services = 0;

  for (const line of lines) {
    if (line.fixed) {
      // Once per idea, however many routes reach it: one run does not pay the
      // mailing house twice because two of its parts need them.
      if (!serviceItems.has(line.node.id)) {
        serviceItems.set(line.node.id, line.node);
        services += line.amount;
      }
    } else if (line.capital) {
      // Once each, however many times the breakdown reaches it.
      if (!capitalItems.has(line.node.id)) {
        capitalItems.set(line.node.id, line.node);
        capital += line.amount;
      }
    } else if (line.time) {
      labour += line.amount;
      hours += line.hours;
    } else {
      materials += line.amount;
    }
  }

  return {
    materials,
    labour,
    hours,
    total: materials + labour + services,
    capital,
    capitalItems: [...capitalItems.values()],
    services,
    serviceItems: [...serviceItems.values()],
    lines,
    unpriced: [...unpriced.values()],
  };
}

/**
 * How many of something a run needs, where both halves have been said.
 *
 * Two thousand door hangers, one hanger to a sheet, is two thousand sheets.
 * A thousand square feet at a hundred to the bag is ten bags, rounded up,
 * because nine and a bit bags is ten bags at the counter.
 *
 * Nothing where the units do not line up. Guessing that "sq ft" and "hangers"
 * are the same thing would produce a number that looks calculated and is not.
 */
export function suggestedQuantity(idea: GraphNode, input: GraphNode): number | null {
  if (!idea.runSize || !input.outputPerUnit) return null;
  if (!idea.runUnit || !input.outputUnit) return null;
  if (idea.runUnit.trim().toLowerCase() !== input.outputUnit.trim().toLowerCase()) return null;
  return Math.ceil(idea.runSize / input.outputPerUnit);
}

/**
 * What a whole list of ideas costs.
 *
 * Used for "everything due this week". Shared inputs are deliberately counted
 * once per idea rather than deduplicated: two campaigns both needing two
 * thousand sheets need four thousand sheets. What they share is the printer,
 * and the printer is a thing you buy once — which is what the equipment lines
 * being separate is for.
 */
export function costOfMany(graph: Graph, nodeIds: string[], maxDepth = 4): CostBreakdown {
  const combined: CostBreakdown = {
    materials: 0,
    labour: 0,
    hours: 0,
    total: 0,
    capital: 0,
    capitalItems: [],
    services: 0,
    serviceItems: [],
    lines: [],
    unpriced: [],
  };
  const unpriced = new Map<string, GraphNode>();
  const capitalItems = new Map<string, GraphNode>();
  const serviceItems = new Map<string, GraphNode>();

  for (const id of nodeIds) {
    const one = costOf(graph, id, maxDepth);
    combined.materials += one.materials;
    combined.labour += one.labour;
    combined.hours += one.hours;
    combined.total += one.total;
    // Deliberately not deduplicated across ideas: two campaigns that each
    // use the mailing house each pay the mailing house. That is the opposite
    // of kit, which is one purchase however many use it.
    combined.services += one.services;
    for (const item of one.serviceItems) serviceItems.set(item.id, item);
    combined.lines.push(...one.lines);
    for (const node of one.unpriced) unpriced.set(node.id, node);
    // The printer three campaigns share is one printer, not three.
    for (const item of one.capitalItems) {
      if (!capitalItems.has(item.id)) {
        capitalItems.set(item.id, item);
        combined.capital += item.estimatedCost ?? 0;
      }
    }
  }

  combined.unpriced = [...unpriced.values()];
  combined.capitalItems = [...capitalItems.values()];
  combined.serviceItems = [...serviceItems.values()];
  return combined;
}

/** Whole dollars. Cents on an estimate of a marketing idea is false
 * precision, and a phone has no room for it. */
export function money(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 100 && amount % 1 !== 0 ? 2 : 0,
  });
}

/** "4 hrs", "1.5 hrs", "2 days" once it stops being a number of hours anybody
 * pictures. */
export function hours(value: number): string {
  if (value === 0) return "0 hrs";
  if (value >= 16) {
    const days = value / 8;
    return `${trim(days)} day${days === 1 ? "" : "s"}`;
  }
  return `${trim(value)} hr${value === 1 ? "" : "s"}`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** How a quantity reads next to its unit: "2,000 sheets", "4 hrs", "1 each"
 * becomes just "1". */
export function describeQuantity(quantity: number, unit: string): string {
  const amount = trim(quantity);

  // A unit this business invented is not in the built-in table, and falling
  // back to "each" would print "2,000 each" for two thousand pallets.
  const known = UNIT_BY_VALUE.get(unit);
  if (!known) {
    const name = unit.trim();
    if (!name) return amount;
    return quantity === 1 ? `1 ${name}` : `${amount} ${name.endsWith("s") ? name : `${name}s`}`;
  }

  const def = known;
  if (def.value === "each") return quantity === 1 ? "1" : amount;
  // "per sheet" is how the price reads; the quantity reads "2,000 sheets".
  const noun = def.label.replace(/^per /, "");
  if (quantity === 1) return `1 ${noun}`;
  return `${amount} ${def.plural ?? (noun.endsWith("s") ? noun : `${noun}s`)}`;
}
