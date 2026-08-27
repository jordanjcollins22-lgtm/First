"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, Link2, Plus, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Graph, GraphNode } from "@/lib/knowledge-graph";
import {
  canSolve,
  describeIssue,
  issueStateOf,
  ISSUE_COLORS,
  ISSUE_LABELS,
  solutionsFor,
} from "@/lib/knowledge-issues";
import { linkSolution, setNodeImage, updateNode } from "@/lib/actions/knowledge-graph-actions";
import { NodeImage } from "@/components/knowledge/node-image";

/**
 * The issue half of a node's panel.
 *
 * Two things a problem needs that nothing else does: a picture of it, and
 * somewhere to say what fixes it. Both sit together because they are the same
 * job — a photo of the bent gate and the name of the welder are, between
 * them, the whole of the problem and the whole of the answer.
 */
export function IssuePanel({
  graph,
  node,
  onChanged,
  onSelect,
}: {
  graph: Graph;
  node: GraphNode;
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");

  const state = issueStateOf(graph, node);
  const solutions = useMemo(() => solutionsFor(graph, node.id), [graph, node.id]);

  // Anything that could be the fix: not this node, not another problem.
  const candidates = useMemo(() => {
    const linked = new Set(solutions.map((s) => s.id));
    const term = search.trim().toLowerCase();
    return graph.nodes
      .filter((n) => !linked.has(n.id) && canSolve(node, n).ok)
      .filter((n) => (term ? n.title.toLowerCase().includes(term) : false))
      .slice(0, 6);
  }, [graph.nodes, node, solutions, search]);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        setLinking(false);
        setNewTitle("");
        setSearch("");
        onChanged();
      } else {
        setError(result.message ?? "Couldn't do that.");
      }
    });
  }

  // Not an issue: one button to say it is, and nothing else in the way.
  if (!state) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => updateNode(node.id, { isIssue: true }))}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline disabled:opacity-50"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Mark this as an issue
        </button>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-900"
          style={{ backgroundColor: ISSUE_COLORS[state] }}
        >
          <AlertTriangle className="h-3 w-3" />
          {ISSUE_LABELS[state]}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => updateNode(node.id, { isIssue: false }))}
          className="shrink-0 text-[11px] text-muted-foreground underline disabled:opacity-50"
        >
          Not an issue
        </button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        {describeIssue({ node, state, solutions })}
      </p>

      {/* A photo of the problem settles in one glance what a paragraph
          argues about. */}
      <div className="mb-3">
        <NodeImage
          path={node.imagePath}
          onChange={(path) => run(() => setNodeImage(node.id, path))}
          label="Photo"
        />
      </div>

      {solutions.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {solutions.map((solution) => (
            <li key={solution.id}>
              <button
                type="button"
                onClick={() => onSelect(solution.id)}
                className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                {solution.status === "completed" || solution.status === "active" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{solution.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{solution.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {linking ? (
        <div className="flex flex-col gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the graph for the fix…"
            className="h-9 text-sm"
          />
          {candidates.length > 0 && (
            <ul className="flex flex-col gap-1">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => linkSolution({ issueId: node.id, solutionId: candidate.id }))
                    }
                    className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Or invent it. The answer to a problem is usually something that
              does not exist yet, which is the whole point of writing it down. */}
          <div className="flex gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="…or name a new fix"
              className="h-9 flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  run(() => linkSolution({ issueId: node.id, title: newTitle }));
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || !newTitle.trim()}
              onClick={() => run(() => linkSolution({ issueId: node.id, title: newTitle }))}
            >
              {pending ? "…" : "Add"}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setLinking(false)}
            className="self-start text-[11px] text-muted-foreground underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={state === "open" ? "default" : "outline"}
          className="w-full gap-1.5"
          onClick={() => setLinking(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          {state === "open" ? "Link the solution" : "Link another solution"}
        </Button>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
