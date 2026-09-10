/**
 * What a kit is carried in, and what to do when it breaks.
 *
 * A kit used to be a number ticked on a tool. But a kit is a physical thing
 * somebody wheels to a van, and which thing matters twice over. At the end of
 * a day the question is not "is it all back" but "is it all back in the right
 * bin". And when a castor snaps off the dolly, the dolly is a thing that has
 * to be re-ordered — which nothing could record, because as far as the app was
 * concerned the bin did not exist.
 *
 * A container names the kits it holds rather than the other way round. One
 * trash-can-and-dolly rig carries kits 1, 2 and 3; a field on a kit could
 * never have said that, and a kit split across two containers is a real thing
 * too.
 *
 * Two shapes of container, because they break differently. One bought off a
 * shelf is replaced whole and has a price and a link. One somebody built is a
 * pile of parts, and what gets re-ordered is the part — a snapped bungee is
 * not a reason to buy another dolly.
 */

export type ContainerKind = "bought" | "built";

export const CONTAINER_KINDS: { key: ContainerKind; label: string; blurb: string }[] = [
  { key: "bought", label: "Bought as one thing", blurb: "A crate, a bag, a tote. Replaced whole." },
  { key: "built", label: "Built from parts", blurb: "A rig somebody assembled. Parts get replaced one at a time." },
];

export interface ContainerPart {
  id: string;
  name: string;
  /** How many go into one of these setups. */
  quantity: number;
  cost: number | null;
  purchaseUrl: string | null;
  /** Broken and not yet replaced. */
  broken: number;
  onOrder: boolean;
  notes: string | null;
  position: number;
}

export interface KitContainer {
  id: string;
  name: string;
  kits: number[];
  kind: ContainerKind;
  /** How many of these we have. */
  quantity: number | null;
  /** What one costs, on a bought container. Built ones cost what their parts cost. */
  cost: number | null;
  purchaseUrl: string | null;
  broken: number;
  onOrder: boolean;
  reorderThreshold: number | null;
  imagePath: string | null;
  notes: string | null;
  archivedAt: string | null;
  parts: ContainerPart[];
}

/** How many we have. Absent means one, the way it does everywhere else. */
export function countOf(container: Pick<KitContainer, "quantity">): number {
  const quantity = container.quantity;
  if (quantity == null) return 1;
  return quantity > 0 ? Math.floor(quantity) : 0;
}

/**
 * What one of these costs.
 *
 * A built rig is worth its parts, added up with their quantities, because
 * nobody types a total for something they assembled out of four receipts. A
 * bought one is whatever it cost, and if the parts of a bought one are priced
 * too — a spare latch, a divider — they are on top of it rather than instead.
 */
export function containerCost(container: KitContainer): number | null {
  const parts = container.parts.reduce(
    (sum, part) => sum + (part.cost != null && part.cost > 0 ? part.cost * Math.max(1, part.quantity) : 0),
    0
  );
  const own = container.cost != null && container.cost > 0 ? container.cost : 0;
  const total = own + parts;
  return total > 0 ? round(total) : null;
}

/** What every container is worth, quantities counted. */
export function containersValue(containers: readonly KitContainer[]): number {
  return round(
    containers.reduce((sum, container) => {
      if (container.archivedAt) return sum;
      const each = containerCost(container);
      return each == null ? sum : sum + each * countOf(container);
    }, 0)
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Which container a kit is in
// ---------------------------------------------------------------------------

/** The containers that hold a given kit. Usually one; occasionally two. */
export function containersForKit(
  containers: readonly KitContainer[],
  kit: number | null
): KitContainer[] {
  if (kit == null) return [];
  return containers.filter((container) => !container.archivedAt && container.kits.includes(kit));
}

/**
 * What to print at the top of a kit's sheet.
 *
 * Null rather than "no container set". The line only earns its place on the
 * page when it says something, and a sheet that spends a line saying nothing
 * is a sheet with one fewer tool on it.
 */
export function storedInLabel(containers: readonly KitContainer[], kit: number | null): string | null {
  const holding = containersForKit(containers, kit);
  if (holding.length === 0) return null;
  return holding.map((container) => container.name).join(" and ");
}

/** "Kits 1, 2 and 3", or "No kit yet". */
export function kitsLabel(kits: readonly number[]): string {
  const sorted = Array.from(new Set(kits.filter((kit) => Number.isFinite(kit)))).sort((a, b) => a - b);
  if (sorted.length === 0) return "No kit yet";
  if (sorted.length === 1) return `Kit ${sorted[0]}`;
  const last = sorted[sorted.length - 1];
  return `Kits ${sorted.slice(0, -1).join(", ")} and ${last}`;
}

/** Kit numbers out of what somebody typed. Forgiving: commas, spaces, both. */
export function parseKits(text: string): number[] {
  const found = new Set<number>();
  for (const piece of text.split(/[^0-9]+/)) {
    const kit = Number(piece);
    if (Number.isInteger(kit) && kit > 0 && kit < 1000) found.add(kit);
  }
  return Array.from(found).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// What needs replacing
// ---------------------------------------------------------------------------

export interface ReorderItem {
  containerId: string;
  containerName: string;
  /** What to buy: the container itself, or one of its parts. */
  name: string;
  /** How many. */
  count: number;
  cost: number | null;
  purchaseUrl: string | null;
  onOrder: boolean;
  /** Why it is on the list, for somebody deciding what to do about it. */
  reason: "broken" | "running low";
  partId: string | null;
}

/**
 * Everything that wants buying, container by container.
 *
 * Two reasons only, and they are said outright rather than merged into a
 * count. Something is broken, or there are fewer left than somebody said they
 * wanted — those are different problems and a crew member reading a list
 * cannot act on the second the way they act on the first.
 *
 * Already on order still appears, marked. Taking it off the list is how a
 * thing gets ordered twice, and how somebody spends a morning wondering
 * whether they ordered it at all.
 */
export function reorderList(containers: readonly KitContainer[]): ReorderItem[] {
  const items: ReorderItem[] = [];

  for (const container of containers) {
    if (container.archivedAt) continue;

    if (container.broken > 0) {
      items.push({
        containerId: container.id,
        containerName: container.name,
        name: container.name,
        count: container.broken,
        cost: container.cost,
        purchaseUrl: container.purchaseUrl,
        onOrder: container.onOrder,
        reason: "broken",
        partId: null,
      });
    } else if (
      container.reorderThreshold != null &&
      container.quantity != null &&
      container.quantity <= container.reorderThreshold
    ) {
      items.push({
        containerId: container.id,
        containerName: container.name,
        name: container.name,
        count: 1,
        cost: container.cost,
        purchaseUrl: container.purchaseUrl,
        onOrder: container.onOrder,
        reason: "running low",
        partId: null,
      });
    }

    for (const part of container.parts) {
      if (part.broken <= 0) continue;
      items.push({
        containerId: container.id,
        containerName: container.name,
        name: part.name,
        count: part.broken,
        cost: part.cost,
        purchaseUrl: part.purchaseUrl,
        onOrder: part.onOrder,
        reason: "broken",
        partId: part.id,
      });
    }
  }

  // Not yet ordered first: that is the list somebody is about to act on, and
  // the ordered ones are there to stop it being bought twice.
  return items.sort(
    (a, b) =>
      Number(a.onOrder) - Number(b.onOrder) ||
      a.containerName.localeCompare(b.containerName) ||
      a.name.localeCompare(b.name)
  );
}

/** Whether a container has anything wrong with it, for a badge on a card. */
export function needsAttention(container: KitContainer): boolean {
  return reorderList([container]).some((item) => !item.onOrder);
}
