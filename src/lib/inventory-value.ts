/**
 * What the tools are worth, added up.
 *
 * Two questions, and they are not the same one. What is tied up in this
 * equipment, and what would it fetch if it went. The first is what was spent
 * and is the number an accountant wants; the second is what could be got back
 * and is the number somebody wants before deciding whether to keep a shed full
 * of things nobody has picked up since March.
 *
 * Three rules, all of them about not overstating it:
 *
 * - A rental is in neither total. It was never ours, and counting a day rate
 *   as an asset would inflate both numbers by something that belongs to a hire
 *   shop. What a rental gets instead is its own line: what buying it outright
 *   would cost, which is the question a day rate keeps raising.
 * - Quantity counts. Three of the same trimmer is three trimmers' worth of
 *   money, and a total that ignores that is wrong by whatever the shed is
 *   fullest of.
 * - Anything owned with no price on it is counted and named rather than
 *   quietly treated as free. A total that is short by an unknown amount is
 *   worse than a total that says how short it is.
 */

import { resaleValue } from "@/lib/resale";

export interface ValuedTool {
  name: string;
  /** What it cost us, per one. A day rate on a rental. */
  cost: number | null;
  /** What somebody said it would fetch, where they disagreed with the default. */
  resaleValue: number | null;
  isRental: boolean;
  /** How many we have. Absent means one. */
  quantity: number | null;
  /** What buying one would cost, on something we rent. */
  costToOwn: number | null;
}

export interface InventoryValue {
  /** What the owned tools cost, all in. */
  purchase: number;
  /** What they would fetch. */
  sell: number;
  /** Individual items behind those totals, quantities counted. */
  items: number;
  /** Kinds of tool priced. */
  priced: number;
  /** Owned tools carrying no price, so the totals can be read honestly. */
  unpriced: number;
  /** A few of them by name, for a line somebody can act on. */
  unpricedNames: string[];
  /** Tools we rent, in neither total. */
  rentals: number;
  /** What buying the rented ones outright would cost, where anybody said. */
  rentalBuyout: number;
}

/** How many of a thing there are. Absent means one; negatives mean nobody typed. */
export function countOf(tool: Pick<ValuedTool, "quantity">): number {
  const quantity = tool.quantity;
  if (quantity == null) return 1;
  return quantity > 0 ? Math.floor(quantity) : 0;
}

/** How many names to print before it stops being a list and starts being a wall. */
const NAMES_SHOWN = 6;

export function valueInventory(tools: readonly ValuedTool[]): InventoryValue {
  const out: InventoryValue = {
    purchase: 0,
    sell: 0,
    items: 0,
    priced: 0,
    unpriced: 0,
    unpricedNames: [],
    rentals: 0,
    rentalBuyout: 0,
  };

  for (const tool of tools) {
    const count = countOf(tool);

    if (tool.isRental) {
      out.rentals += 1;
      if (tool.costToOwn != null && tool.costToOwn > 0) out.rentalBuyout += tool.costToOwn * count;
      continue;
    }

    out.items += count;

    if (tool.cost == null || tool.cost <= 0) {
      out.unpriced += 1;
      if (out.unpricedNames.length < NAMES_SHOWN) out.unpricedNames.push(tool.name);
      // An override is still worth something even with no cost behind it: it
      // is somebody saying outright what the thing would fetch.
      const resale = resaleValue({ cost: tool.cost, override: tool.resaleValue });
      if (resale != null) out.sell += resale * count;
      continue;
    }

    out.priced += 1;
    out.purchase += tool.cost * count;
    const resale = resaleValue({ cost: tool.cost, override: tool.resaleValue });
    if (resale != null) out.sell += resale * count;
  }

  // Rounded once at the end. Rounding each row would drift by a few dollars
  // across a shed's worth of tools, in whichever direction the cents fell.
  out.purchase = round(out.purchase);
  out.sell = round(out.sell);
  out.rentalBuyout = round(out.rentalBuyout);
  return out;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Dollars, no cents. Nobody reads the cents on a shed full of tools. */
export function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
