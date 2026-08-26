"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GraphCanvas, type Point } from "@/components/knowledge/graph-canvas";
import { NodePanel, TypeSelect } from "@/components/knowledge/node-panel";
import { createNode, saveNodePositions } from "@/lib/actions/knowledge-graph-actions";
import { fitToCanvas, layoutGraph, seedPositions } from "@/lib/graph-layout";
import {
  EMPTY_FILTERS,
  NODE_STATUSES,
  NODE_TYPES,
  applyFilters,
  degreeMap,
  findSimilarNodes,
  isolatedNodes,
  localGraph,
  nodeTypeDef,
  sharedResources,
  type Graph,
  type GraphFilters,
  type NodeType,
} from "@/lib/knowledge-graph";

/**
 * The thinking environment.
 *
 * Everything is arranged around one rule: getting a thought in has to be
 * faster than deciding not to bother. So the top of the screen is a single
 * box and a button, the graph is underneath it, and every form that asks for
 * more than a name lives behind a node somebody has already created.
 *
 * The graph is held whole in the browser. Filtering, the local view, the
 * duplicate check and the shared-resource count are all pure functions over
 * that one copy, which is why they are instant and why they can never disagree
 * with each other.
 */
export function KnowledgeWorkspace({
  graph,
  tags,
  canDelete,
}: {
  graph: Graph;
  tags: string[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [filters, setFilters] = useState<GraphFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moved, setMoved] = useState<Map<string, Point>>(new Map());
  const [message, setMessage] = useState<string | null>(null);

  // Quick add.
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<NodeType>("idea");
  const [showType, setShowType] = useState(false);

  const visible = useMemo(
    () => (focusId ? localGraph(graph, focusId, depth) : applyFilters(graph, filters)),
    [graph, filters, focusId, depth]
  );

  const degrees = useMemo(() => degreeMap(graph), [graph]);
  const shared = useMemo(() => sharedResources(graph), [graph]);
  const orphans = useMemo(() => isolatedNodes(graph), [graph]);
  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId]
  );

  const duplicates = useMemo(
    () => (draft.trim().length < 2 ? [] : findSimilarNodes(graph.nodes, draft, 4)),
    [graph.nodes, draft]
  );

  /**
   * Where everything sits.
   *
   * Two layers, because they answer to different things. The simulation is a
   * pure function of the visible graph and the canvas size, so it re-runs when
   * one of those changes and never otherwise. A drag lands in the overrides on
   * top of it, so moving a node cannot re-run the physics underneath the
   * finger doing the moving.
   *
   * Overrides are never cleared: a position somebody dragged is on its way to
   * the database, and throwing it away because a filter changed would show
   * them the arrangement they just replaced.
   */
  const layout = useMemo(() => {
    if (!size.width || !size.height || visible.nodes.length === 0) return new Map<string, Point>();

    const seeds = seedPositions(visible.nodes, size.width, size.height);
    const laid = layoutGraph(
      visible.nodes.map((node) => {
        const seed = seeds.get(node.id)!;
        const saved = node.positionX != null && node.positionY != null;
        return {
          id: node.id,
          x: saved ? node.positionX! : seed.x,
          y: saved ? node.positionY! : seed.y,
          weight: 1 + (degrees.get(node.id) ?? 0) * 0.5,
          pinned: saved,
        };
      }),
      visible.edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId, strength: e.strength })),
      {
        width: size.width,
        height: size.height,
        // Loose enough that two labels do not land on top of each other.
        // Absolute distance does not survive fitToCanvas anyway, so what
        // these numbers really set is how far the cluster opens relative to
        // whatever is furthest from it.
        linkDistance: 110,
        repulsion: 16000,
      }
    );

    // Spread it out, unless somebody has already arranged part of it by hand
    // — rescaling around a node they placed would move the one thing they
    // decided the position of.
    const anchored = visible.nodes.some((n) => n.positionX != null && n.positionY != null);
    const placed = anchored ? laid : fitToCanvas(laid, size.width, size.height);

    return new Map<string, Point>(placed.map((n) => [n.id, { x: n.x, y: n.y }]));
  }, [visible, degrees, size.width, size.height]);

  const positions = useMemo(() => {
    const merged = new Map(layout);
    for (const [id, point] of moved) if (merged.has(id)) merged.set(id, point);
    return merged;
  }, [layout, moved]);

  const handleMeasure = useCallback((next: { width: number; height: number }) => {
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
  }, []);

  function handleMove(id: string, point: Point) {
    setMoved((current) => new Map(current).set(id, point));
  }

  function handleMoveEnd(id: string) {
    const point = positions.get(id);
    if (!point) return;
    // Fired and not awaited: the node is already under the finger that put it
    // there, and blocking a drop on a round trip is how a board feels heavy.
    void saveNodePositions([{ id, x: point.x, y: point.y }]);
  }

  function add(title: string, nodeType: NodeType, point?: Point) {
    if (!title.trim()) return;
    start(async () => {
      const result = await createNode({
        title,
        nodeType,
        positionX: point?.x ?? null,
        positionY: point?.y ?? null,
      });
      setMessage(result.message ?? null);
      if (result.ok) {
        setDraft("");
        router.refresh();
      }
    });
  }

  const totals = `${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"} · ${graph.edges.length} connection${graph.edges.length === 1 ? "" : "s"}`;

  return (
    <div>
      {/* Quick capture. One box, always at the top, never behind a button. */}
      <div className="mb-3 rounded-xl border border-white/60 bg-card/70 p-3 backdrop-blur-md">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add(draft, draftType);
            }}
            placeholder="Door hangers for the Bel Air cul-de-sacs…"
            className="h-10 flex-1 text-sm"
          />
          <Button type="button" disabled={pending || !draft.trim()} onClick={() => add(draft, draftType)}>
            {pending ? "…" : "Add"}
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowType((s) => !s)}
            className="text-xs text-muted-foreground underline"
          >
            {showType ? "Hide type" : `Type: ${nodeTypeDef(draftType).label}`}
          </button>
          <span className="text-xs text-muted-foreground">Enter adds it. Everything else can wait.</span>
        </div>
        {showType && (
          <div className="mt-2 max-w-xs">
            <TypeSelect value={draftType} onChange={setDraftType} />
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] text-muted-foreground">
              Already here — open one instead of making a second copy:
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {duplicates.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="rounded-full border border-border px-2 py-1 text-xs"
                  onClick={() => {
                    setSelectedId(d.id);
                    setDraft("");
                  }}
                >
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: nodeTypeDef(d.nodeType).color }}
                  />
                  {d.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
      </div>

      {/* Search and the local view live together: both answer "show me less". */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search"
          className="h-9 w-full text-sm sm:w-56"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
          {showFilters ? "Hide filters" : "Filters"}
        </Button>
        {focusId ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setFocusId(null)}>
              Whole graph
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDepth((d) => (d >= 3 ? 1 : d + 1))}
            >
              {depth} hop{depth === 1 ? "" : "s"}
            </Button>
          </>
        ) : (
          selected && (
            <Button type="button" size="sm" variant="outline" onClick={() => setFocusId(selected.id)}>
              Local graph
            </Button>
          )
        )}
        <span className="text-xs text-muted-foreground">
          {focusId ? `Around ${graph.nodes.find((n) => n.id === focusId)?.title ?? ""}` : totals}
        </span>
      </div>

      {showFilters && (
        <div className="mb-3 rounded-xl border border-white/60 bg-card/70 p-3 text-xs backdrop-blur-md">
          <p className="mb-1 font-semibold">Type</p>
          <ChipRow
            options={NODE_TYPES.map((t) => ({ value: t.value, label: t.label, color: t.color }))}
            selected={filters.nodeTypes}
            onToggle={(value) => setFilters({ ...filters, nodeTypes: toggle(filters.nodeTypes, value) })}
          />
          <p className="mb-1 mt-3 font-semibold">Status</p>
          <ChipRow
            options={NODE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            selected={filters.statuses}
            onToggle={(value) => setFilters({ ...filters, statuses: toggle(filters.statuses, value) })}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters.showIsolated}
                onChange={(e) => setFilters({ ...filters, showIsolated: e.target.checked })}
              />
              Show unconnected ({orphans.length})
            </label>
            <button
              type="button"
              className="underline text-muted-foreground"
              onClick={() => setFilters({ ...EMPTY_FILTERS, nodeTypes: new Set(), statuses: new Set(), relationshipTypes: new Set() })}
            >
              Clear filters
            </button>
          </div>
          {tags.length > 0 && (
            <p className="mt-3 text-muted-foreground">Tags in use: {tags.join(", ")}</p>
          )}
        </div>
      )}

      <GraphCanvas
        graph={visible}
        positions={positions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onCreateAt={(point) => {
          const title = window.prompt("What is it?");
          if (title) add(title, draftType, point);
        }}
        onMeasure={handleMeasure}
      />

      <p className="mb-4 mt-1.5 text-[11px] text-muted-foreground">
        Drag to move a node, drag the background to pan, pinch or scroll to zoom, tap a node to open it,
        double-tap empty space to add one there. Size is how many things touch it.
      </p>

      {selected && (
        <div className="mb-4">
          <NodePanel
            key={selected.id}
            graph={graph}
            node={selected}
            canDelete={canDelete}
            onClose={() => setSelectedId(null)}
            onFocus={() => setFocusId(selected.id)}
            onSelect={(id) => setSelectedId(id)}
            onChanged={() => router.refresh()}
          />
        </div>
      )}

      {shared.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
          <h2 className="text-lg font-bold">What more than one idea needs</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Seven marketing ideas look like seven problems until something counts the printer. Buy the top
            of this list once.
          </p>
          <ul className="flex flex-col gap-2">
            {shared.map(({ node, dependents }) => (
              <li key={node.id} className="rounded-lg border border-border/60 p-2">
                <button type="button" onClick={() => setSelectedId(node.id)} className="w-full text-left">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: nodeTypeDef(node.nodeType).color }}
                    />
                    <span className="text-sm font-medium">{node.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {dependents.length} ideas
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {dependents.map((d) => d.title).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-white/60 bg-card/70 p-3 text-[11px] backdrop-blur-md">
        <p className="mb-1.5 font-semibold">Legend</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {NODE_TYPES.map((t) => (
            <span key={t.value} className="flex items-center gap-1 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function ChipRow({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string; color?: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={`rounded-full border px-2 py-1 ${
              on ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground"
            }`}
          >
            {option.color && (
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                style={{ backgroundColor: option.color }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
