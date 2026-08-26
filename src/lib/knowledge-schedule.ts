/**
 * Ideas with dates on them.
 *
 * An idea nobody put a date against is a note. The whole reason for knowing
 * that door hangers, flyers and postcards run through one printer is that the
 * printer should then be busy — which only happens if the ideas themselves
 * come round again on their own.
 *
 * Everything here works on YYYY-MM-DD strings rather than Date objects. A
 * recurrence computed through a timezone is a recurrence that drifts a day
 * every few months, and "the first Monday" quietly becoming "the last Sunday"
 * is the kind of bug nobody notices until a season has gone.
 */

import type { Graph, GraphNode } from "@/lib/knowledge-graph";

export type Recurrence = "none" | "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export interface RecurrenceDef {
  value: Recurrence;
  label: string;
  /** How it reads with an interval in front of it: "every 2 weeks". */
  unit: string;
}

export const RECURRENCES: RecurrenceDef[] = [
  { value: "none", label: "One-off", unit: "time" },
  { value: "daily", label: "Daily", unit: "day" },
  { value: "weekly", label: "Weekly", unit: "week" },
  { value: "fortnightly", label: "Fortnightly", unit: "fortnight" },
  { value: "monthly", label: "Monthly", unit: "month" },
  { value: "quarterly", label: "Quarterly", unit: "quarter" },
  { value: "yearly", label: "Yearly", unit: "year" },
];

const RECURRENCE_BY_VALUE = new Map(RECURRENCES.map((r) => [r.value, r]));

export function recurrenceDef(value: string): RecurrenceDef {
  return RECURRENCE_BY_VALUE.get(value as Recurrence) ?? RECURRENCE_BY_VALUE.get("none")!;
}

/** "Every 3 weeks", or just "Weekly" when the interval is one. */
export function describeRecurrence(recurrence: Recurrence, interval = 1): string {
  const def = recurrenceDef(recurrence);
  if (def.value === "none") return "One-off";
  if (interval <= 1) return def.label;
  return `Every ${interval} ${def.unit}s`;
}

export function todayKey(now = new Date()): string {
  return format(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parse(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(key: string, days: number): string {
  const parts = parse(key);
  if (!parts) return key;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Months, with the end of the month handled the way a person means it.
 *
 * The 31st plus a month is the 30th, not the 1st of the month after. Somebody
 * who scheduled something for the last day of January meant the end of the
 * month, and rolling it into March is how a monthly job silently skips
 * February.
 */
export function addMonths(key: string, months: number): string {
  const parts = parse(key);
  if (!parts) return key;
  const total = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return format(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

/** One step forward. Null for a one-off, which has no next. */
export function advance(key: string, recurrence: Recurrence, interval = 1): string | null {
  const step = Math.max(1, Math.round(interval));
  switch (recurrence) {
    case "daily":
      return addDays(key, step);
    case "weekly":
      return addDays(key, 7 * step);
    case "fortnightly":
      return addDays(key, 14 * step);
    case "monthly":
      return addMonths(key, step);
    case "quarterly":
      return addMonths(key, 3 * step);
    case "yearly":
      return addMonths(key, 12 * step);
    default:
      return null;
  }
}

/**
 * The next time this comes round on or after a given day.
 *
 * Rolls forward rather than adding one step, because a weekly thing nobody
 * ticked off for a month should come back as "this week", not as four
 * separate misses. The graph is for deciding what to do next, and a list of
 * everything somebody failed to do is not that.
 */
export function nextOccurrence(
  scheduledFor: string,
  recurrence: Recurrence,
  interval = 1,
  onOrAfter: string
): string | null {
  if (recurrence === "none") return scheduledFor >= onOrAfter ? scheduledFor : null;

  let cursor = scheduledFor;
  // Bounded so a bad interval cannot spin: 500 steps covers a daily job left
  // alone for over a year.
  for (let step = 0; step < 500; step++) {
    if (cursor >= onOrAfter) return cursor;
    const next = advance(cursor, recurrence, interval);
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return cursor;
}

/** Every time it lands inside a window. What makes "two print runs the same
 * week" a thing anybody can see. */
export function occurrencesBetween(
  scheduledFor: string,
  recurrence: Recurrence,
  interval: number,
  from: string,
  to: string,
  limit = 60
): string[] {
  const out: string[] = [];
  let cursor = scheduledFor;

  for (let step = 0; step < 500 && out.length < limit; step++) {
    if (cursor > to) break;
    if (cursor >= from) out.push(cursor);
    const next = advance(cursor, recurrence, interval);
    if (!next || next === cursor) break;
    cursor = next;
  }

  // An overdue one-off still counts as landing in the window: it was meant to
  // happen and hasn't, which is exactly what somebody wants to be shown.
  if (out.length === 0 && recurrence === "none" && scheduledFor < from) return [scheduledFor];
  return out;
}

export interface ScheduledNode {
  node: GraphNode;
  /** The date it is next wanted — the stored one, or the next one that has
   * come round if the stored one has gone by. */
  due: string;
  overdue: boolean;
}

export interface ScheduleBuckets {
  overdue: ScheduledNode[];
  today: ScheduledNode[];
  soon: ScheduledNode[];
  later: ScheduledNode[];
}

/**
 * What is due, in the order somebody cares.
 *
 * Overdue first, deliberately. Everything else on this page is about what
 * could be done; this is the one part that is about what was supposed to be.
 */
export function scheduleBuckets(nodes: GraphNode[], today: string, soonDays = 7): ScheduleBuckets {
  const buckets: ScheduleBuckets = { overdue: [], today: [], soon: [], later: [] };
  const soonEnd = addDays(today, soonDays);

  for (const node of nodes) {
    if (!node.scheduledFor || node.status === "archived") continue;

    const overdue = node.scheduledFor < today;
    const due = overdue
      ? nextOccurrence(node.scheduledFor, node.recurrence, node.recurrenceInterval, today) ??
        node.scheduledFor
      : node.scheduledFor;

    const entry: ScheduledNode = { node, due, overdue };

    // A recurring thing that has already rolled past today is not overdue —
    // it simply happened and came round again.
    if (overdue && due < today) buckets.overdue.push(entry);
    else if (overdue && node.recurrence === "none") buckets.overdue.push(entry);
    else if (due === today) buckets.today.push(entry);
    else if (due <= soonEnd) buckets.soon.push(entry);
    else buckets.later.push(entry);
  }

  const byDate = (a: ScheduledNode, b: ScheduledNode) =>
    a.due.localeCompare(b.due) || a.node.title.localeCompare(b.node.title);

  buckets.overdue.sort(byDate);
  buckets.today.sort(byDate);
  buckets.soon.sort(byDate);
  buckets.later.sort(byDate);
  return buckets;
}

export interface LeverageUse {
  node: GraphNode;
  due: string;
  /** How many units that idea needs, where somebody has said. */
  quantity: number | null;
}

export interface Leverage {
  /** The thing more than one scheduled idea needs. */
  resource: GraphNode;
  /** Which ideas need it, and when. */
  uses: LeverageUse[];
  /** Everything they need between them — the number to put on one order
   * instead of two. Null where no quantities have been filled in. */
  totalQuantity: number | null;
  /** What that comes to, where the resource has a price. */
  totalAmount: number | null;
}

/**
 * Things two scheduled ideas both need inside the same window.
 *
 * This is the payoff of putting dates on ideas at all. Knowing that door
 * hangers and flyers share a printer is worth something; knowing they are
 * both due the same fortnight is worth doing something about, because that is
 * one print run instead of two, one setup, one delivery charge.
 */
export function leverageInWindow(
  graph: Graph,
  today: string,
  windowDays = 30,
  minimumUses = 2
): Leverage[] {
  const end = addDays(today, windowDays);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const dueByNode = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!node.scheduledFor || node.status === "archived") continue;
    const occurrences = occurrencesBetween(
      node.scheduledFor,
      node.recurrence,
      node.recurrenceInterval,
      today,
      end
    );
    if (occurrences.length > 0) dueByNode.set(node.id, occurrences[0]);
  }

  const usesOf = new Map<string, LeverageUse[]>();
  for (const edge of graph.edges) {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (!source || !target) continue;
    // Something scheduled leaning on something that is not itself scheduled
    // work. Two scheduled ideas pointing at each other is a sequence, not a
    // shared resource.
    if (target.nodeType === "idea") continue;

    const due = dueByNode.get(source.id);
    if (!due) continue;

    const list = usesOf.get(target.id) ?? [];
    if (!list.some((u) => u.node.id === source.id)) {
      list.push({ node: source, due, quantity: edge.quantity ?? null });
    }
    usesOf.set(target.id, list);
  }

  return [...usesOf.entries()]
    .filter(([, uses]) => uses.length >= minimumUses)
    .map(([id, uses]) => {
      const resource = byId.get(id)!;
      const quantities = uses.map((u) => u.quantity).filter((q): q is number => q != null);
      const totalQuantity = quantities.length > 0 ? quantities.reduce((a, b) => a + b, 0) : null;
      return {
        resource,
        uses: uses.sort((a, b) => a.due.localeCompare(b.due)),
        totalQuantity,
        totalAmount:
          totalQuantity != null && resource.estimatedCost != null
            ? totalQuantity * resource.estimatedCost
            : null,
      };
    })
    .sort(
      (a, b) =>
        b.uses.length - a.uses.length ||
        a.uses[0].due.localeCompare(b.uses[0].due) ||
        a.resource.title.localeCompare(b.resource.title)
    );
}

/** Human-readable gap, for a row that has to fit on a phone. */
export function describeDue(due: string, today: string): string {
  if (due === today) return "Today";
  const days = daysBetween(today, due);
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days <= 14) return `In ${days} days`;
  return due;
}

export function daysBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return 0;
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000);
}
