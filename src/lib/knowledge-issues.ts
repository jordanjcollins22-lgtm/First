import type { Graph, GraphNode, NodeStatus } from "@/lib/knowledge-graph";

/**
 * Problems on the graph, and whether anything has answered them.
 *
 * Derived from the edges rather than stored on the node. A stored "solved"
 * flag is a second opinion about the same fact, and the two disagree the
 * first time somebody unlinks a solution and forgets to untick the box. Read
 * off the graph it cannot drift: an issue is open exactly when nothing is
 * linked as its solution.
 */

export type IssueState =
  /** Nobody has said what would fix this. */
  | "open"
  /** Somebody has linked a solution, but the solution has not been done. */
  | "answered"
  /** The solution is under way or finished. */
  | "solved";

/** Red, amber, green. Chosen to read as small dots on a dark field. */
export const ISSUE_COLORS: Record<IssueState, string> = {
  open: "#ef4444",
  answered: "#f59e0b",
  solved: "#22c55e",
};

export const ISSUE_LABELS: Record<IssueState, string> = {
  open: "Unsolved",
  answered: "Solution planned",
  solved: "Solved",
};

/** The edge that means "this is what fixes it". */
export const SOLVED_BY = "solved_by";

/**
 * A solution counts as done once it is being acted on.
 *
 * "Active" as well as "completed": a process that runs every week is solving
 * the problem continuously and never becomes completed. Holding out for
 * completed would leave a permanently amber issue that is in fact handled.
 */
const DOING: NodeStatus[] = ["active", "completed"];

/** The nodes linked as solutions to this issue, in graph order. */
export function solutionsFor(graph: Graph, issueId: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: GraphNode[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.relationshipType !== SOLVED_BY) continue;
    // Directional on purpose: the issue points at what solves it. The reverse
    // edge would read "this solution is solved by that problem", which is not
    // a thing anybody means.
    if (edge.sourceId !== issueId) continue;
    if (seen.has(edge.targetId)) continue;
    const node = byId.get(edge.targetId);
    if (node) {
      seen.add(edge.targetId);
      out.push(node);
    }
  }
  return out;
}

/**
 * Where an issue has got to.
 *
 * A node that is not flagged as an issue has no state — asking is a category
 * error, and returning "solved" for a bag of mulch would put green dots all
 * over a graph that has no problems on it.
 */
export function issueStateOf(graph: Graph, node: GraphNode): IssueState | null {
  if (!node.isIssue) return null;

  const solutions = solutionsFor(graph, node.id);
  if (solutions.length === 0) return "open";
  return solutions.some((s) => DOING.includes(s.status)) ? "solved" : "answered";
}

/** What colour to draw a node, or null to leave its type colour alone. */
export function issueColorFor(graph: Graph, node: GraphNode): string | null {
  const state = issueStateOf(graph, node);
  return state ? ISSUE_COLORS[state] : null;
}

export interface IssueSummary {
  node: GraphNode;
  state: IssueState;
  solutions: GraphNode[];
}

/**
 * Every issue on the graph, worst first.
 *
 * Open before answered before solved, and within each the most important
 * first — an unsolved problem nobody rated still outranks a solved one, so
 * importance breaks ties rather than setting the order.
 */
export function listIssues(graph: Graph): IssueSummary[] {
  const order: Record<IssueState, number> = { open: 0, answered: 1, solved: 2 };

  return graph.nodes
    .filter((n) => n.isIssue)
    .map((node) => ({
      node,
      state: issueStateOf(graph, node) ?? "open",
      solutions: solutionsFor(graph, node.id),
    }))
    .sort((a, b) => {
      if (a.state !== b.state) return order[a.state] - order[b.state];
      const ai = a.node.importance ?? 0;
      const bi = b.node.importance ?? 0;
      if (ai !== bi) return bi - ai;
      return a.node.title.localeCompare(b.node.title);
    });
}

/** Just the ones still needing an answer. The number worth putting on a tab. */
export function openIssues(graph: Graph): IssueSummary[] {
  return listIssues(graph).filter((i) => i.state === "open");
}

export type SolveVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether this node can be linked as the solution to that issue.
 *
 * Refuses the two things that produce a graph which lies about itself: a
 * problem solving itself, and a problem being solved by a problem. The second
 * is not pedantry — an issue whose only solution is another open issue would
 * read as answered on the graph while nothing has actually been decided.
 */
export function canSolve(issue: GraphNode, solution: GraphNode): SolveVerdict {
  if (!issue.isIssue) return { ok: false, reason: "That isn't marked as an issue." };
  if (issue.id === solution.id) {
    return { ok: false, reason: "Something can't be its own solution." };
  }
  if (solution.isIssue) {
    return {
      ok: false,
      reason: "That's another issue. Link something that fixes this one, not another problem.",
    };
  }
  return { ok: true };
}

/** A short line for the panel: what state, and what is linked. */
export function describeIssue(summary: IssueSummary): string {
  if (summary.state === "open") return "Unsolved — nothing linked as the fix yet.";
  const names = summary.solutions.map((s) => s.title).join(", ");
  return summary.state === "solved" ? `Solved by ${names}.` : `Solution planned: ${names}.`;
}
