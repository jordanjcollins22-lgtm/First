/**
 * Squeezing everything out of what is already being done.
 *
 * Two questions, and they are the same question from both ends.
 *
 * Where do things cross? Not "which two ideas both list the printer" — that
 * one was easy and is already answered. This is the deeper version: door
 * hangers go through a print run, the print run needs the printer, and the
 * postcards get there by a completely different route. Nothing on either
 * idea's own screen says they meet, and they do.
 *
 * And what does any of it earn? A flyer costs money and, as far as most
 * businesses ever notice, that is the end of it. But a flyer is a piece of
 * paper going through six hundred doors, and a piece of paper going through
 * six hundred doors has advertising space on it. Nothing here invents that
 * idea for anybody — it just refuses to let an idea sit there with a cost and
 * no answer to "and what comes back".
 */

import { costOf, isCapital, type CostBreakdown } from "@/lib/knowledge-cost";
import type { Graph, GraphNode } from "@/lib/knowledge-graph";

/** Where one idea's chain of requirements meets another's. */
export interface Crossing {
  node: GraphNode;
  through: {
    idea: GraphNode;
    /** How far down that idea's breakdown this sits. */
    depth: number;
    /** The chain that gets there, from the idea to this node. */
    path: GraphNode[];
    quantity: number;
    /** Whether every hop said how many, or something along the way defaulted. */
    quantityStated: boolean;
    amount: number;
  }[];
  /** Everything they need between them. */
  totalQuantity: number;
  /** False where somebody has not said how many yet, in which case the total
   * is a count of ideas rather than a number of sheets. */
  quantityStated: boolean;
  /** What that comes to. Kit is counted once — it is one purchase. */
  totalAmount: number;
  capital: boolean;
  /** True where at least one idea reaches it through something else. Those
   * are the ones worth showing: a crossing everybody can already see on
   * their own screen is not news. */
  indirect: boolean;
}

/**
 * Every place two or more ideas' requirements meet, at any depth.
 *
 * Built on the same walk that prices an idea, so it can never disagree with
 * the totals — if the cost breakdown reaches the printer, so does this, by
 * the same route and with the same quantity.
 */
export function crossings(graph: Graph, minIdeas = 2): Crossing[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ideas = graph.nodes.filter((n) => n.nodeType === "idea" && n.status !== "archived");

  const meetings = new Map<string, Crossing["through"]>();

  for (const idea of ideas) {
    const breakdown = costOf(graph, idea.id);
    // One entry per node per idea: the shallowest route is the one to show,
    // because it is the one somebody will recognise.
    const shallowest = new Map<string, (typeof breakdown.lines)[number]>();
    for (const line of breakdown.lines) {
      const existing = shallowest.get(line.node.id);
      if (!existing || line.depth < existing.depth) shallowest.set(line.node.id, line);
    }

    for (const [nodeId, line] of shallowest) {
      const list = meetings.get(nodeId) ?? [];
      list.push({
        idea,
        depth: line.depth,
        path: line.path.map((id) => byId.get(id)).filter((n): n is GraphNode => n != null),
        quantity: line.quantity,
        quantityStated: line.quantityStated,
        amount: line.amount,
      });
      meetings.set(nodeId, list);
    }
  }

  return [...meetings.entries()]
    .filter(([nodeId, through]) => through.length >= minIdeas && byId.get(nodeId)?.nodeType !== "idea")
    .map(([nodeId, through]) => {
      const node = byId.get(nodeId)!;
      const capital = isCapital(node);
      return {
        node,
        through: through.sort((a, b) => a.depth - b.depth || a.idea.title.localeCompare(b.idea.title)),
        totalQuantity: through.reduce((sum, t) => sum + t.quantity, 0),
        quantityStated: through.every((t) => t.quantityStated),
        // One printer, however many ideas run through it.
        totalAmount: capital
          ? node.estimatedCost ?? 0
          : through.reduce((sum, t) => sum + t.amount, 0),
        capital,
        indirect: through.some((t) => t.depth > 0),
      };
    })
    .sort(
      (a, b) =>
        // Deep crossings first: those are the ones nobody could already see.
        Number(b.indirect) - Number(a.indirect) ||
        b.through.length - a.through.length ||
        b.totalAmount - a.totalAmount ||
        a.node.title.localeCompare(b.node.title)
    );
}

export interface RevenueLine {
  node: GraphNode;
  quantity: number;
  unitValue: number;
  amount: number;
}

export interface Payback {
  revenue: number;
  lines: RevenueLine[];
  cost: CostBreakdown;
  /** Revenue less what a run costs. Kit is left out — a printer is not a cost
   * of one flyer run, and counting it against the first one makes every idea
   * look like a loss until it has paid for the building. */
  net: number;
  coversItself: boolean;
  /** Where nothing earns from it yet, and it costs something. The prompt. */
  unanswered: boolean;
}

/**
 * What an idea earns, against what it costs.
 *
 * Only direct connections count as revenue. "This idea earns that" is a claim
 * somebody makes about that idea, and inheriting it down a chain would let one
 * ad spot on a flyer quietly make three other ideas look profitable.
 */
export function paybackOf(graph: Graph, nodeId: string): Payback {
  const cost = costOf(graph, nodeId);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines: RevenueLine[] = [];

  for (const edge of graph.edges) {
    if (edge.sourceId !== nodeId) continue;
    const target = byId.get(edge.targetId);
    if (!target) continue;
    if (edge.relationshipType !== "generates_revenue" && target.nodeType !== "revenue_source") continue;

    const quantity = edge.quantity ?? 1;
    const unitValue = target.potentialValue ?? 0;
    lines.push({ node: target, quantity, unitValue, amount: quantity * unitValue });
  }

  const revenue = lines.reduce((sum, l) => sum + l.amount, 0);

  return {
    revenue,
    lines,
    cost,
    net: revenue - cost.total,
    coversItself: revenue > 0 && revenue >= cost.total,
    unanswered: lines.length === 0 && cost.total > 0,
  };
}

export interface EarningGap {
  idea: GraphNode;
  payback: Payback;
}

/**
 * Ideas that cost something and earn nothing.
 *
 * Not a criticism of them — plenty of things a business does are meant to
 * cost money. It is a list of the places nobody has yet asked the question,
 * ordered by how much is going out, because that is the order in which the
 * question is worth asking.
 */
export function notEarningYet(graph: Graph): EarningGap[] {
  return graph.nodes
    .filter((n) => n.nodeType === "idea" && n.status !== "archived")
    .map((idea) => ({ idea, payback: paybackOf(graph, idea.id) }))
    .filter((gap) => gap.payback.unanswered)
    .sort((a, b) => b.payback.cost.total - a.payback.cost.total);
}

export interface ProvenEarner {
  /** A way of making money that already works somewhere. */
  revenue: GraphNode;
  earningFrom: GraphNode[];
  /**
   * Ideas that share something with one of those, and have not been asked the
   * same question. Suggested rather than invented: this is a thing the
   * business already does, pointed at a thing the business already has.
   */
  couldAlsoEarn: GraphNode[];
}

/**
 * A way of earning that works on one idea, and the ideas near enough that it
 * might work on them too.
 *
 * "Near enough" means they cross paths — they share a material, a process, a
 * printer. Selling ad space on a flyer works because a flyer is paper going
 * through a door; anything else going through that same door on that same
 * paper is the same opportunity, and nothing else in the app would ever say
 * so.
 */
export function provenEarners(graph: Graph): ProvenEarner[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Which ideas already earn through each revenue source.
  const earners = new Map<string, GraphNode[]>();
  for (const edge of graph.edges) {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (!source || !target) continue;
    if (source.nodeType !== "idea") continue;
    if (edge.relationshipType !== "generates_revenue" && target.nodeType !== "revenue_source") continue;

    const list = earners.get(target.id) ?? [];
    if (!list.some((n) => n.id === source.id)) list.push(source);
    earners.set(target.id, list);
  }

  if (earners.size === 0) return [];

  // Who crosses paths with whom, from the crossings already worked out.
  const neighbours = new Map<string, Set<string>>();
  for (const crossing of crossings(graph)) {
    const ids = crossing.through.map((t) => t.idea.id);
    for (const id of ids) {
      const set = neighbours.get(id) ?? new Set<string>();
      for (const other of ids) if (other !== id) set.add(other);
      neighbours.set(id, set);
    }
  }

  return [...earners.entries()]
    .map(([revenueId, earningFrom]) => {
      const alreadyEarning = new Set(earningFrom.map((n) => n.id));
      const candidates = new Map<string, GraphNode>();

      for (const idea of earningFrom) {
        for (const nearbyId of neighbours.get(idea.id) ?? []) {
          if (alreadyEarning.has(nearbyId)) continue;
          const nearby = byId.get(nearbyId);
          if (nearby && nearby.status !== "archived") candidates.set(nearbyId, nearby);
        }
      }

      return {
        revenue: byId.get(revenueId)!,
        earningFrom,
        couldAlsoEarn: [...candidates.values()].sort((a, b) => a.title.localeCompare(b.title)),
      };
    })
    .filter((suggestion) => suggestion.couldAlsoEarn.length > 0)
    .sort(
      (a, b) =>
        b.couldAlsoEarn.length - a.couldAlsoEarn.length ||
        a.revenue.title.localeCompare(b.revenue.title)
    );
}

/** What the whole graph is spending and earning, for the line at the top. */
export function leverageSummary(graph: Graph): {
  spending: number;
  earning: number;
  net: number;
  earningIdeas: number;
  totalIdeas: number;
} {
  const ideas = graph.nodes.filter((n) => n.nodeType === "idea" && n.status !== "archived");
  let spending = 0;
  let earning = 0;
  let earningIdeas = 0;

  for (const idea of ideas) {
    const payback = paybackOf(graph, idea.id);
    spending += payback.cost.total;
    earning += payback.revenue;
    if (payback.revenue > 0) earningIdeas++;
  }

  return { spending, earning, net: earning - spending, earningIdeas, totalIdeas: ideas.length };
}
