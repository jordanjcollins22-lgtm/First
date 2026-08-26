"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MaterialOption } from "@/lib/inventory-groups";
import type { UnitOption } from "@/lib/data/knowledge-graph";
import { GraphCanvas, type Point } from "@/components/knowledge/graph-canvas";
import { NodePanel, TypeSelect } from "@/components/knowledge/node-panel";
import { createNode, markNodeDone, saveNodePositions } from "@/lib/actions/knowledge-graph-actions";
import {
  costOf,
  costOfMany,
  describeQuantity,
  hours as formatHours,
  isCapital,
  isTimeUnit,
  money,
} from "@/lib/knowledge-cost";
import {
  crossings,
  leverageSummary,
  notEarningYet,
  provenEarners,
} from "@/lib/knowledge-leverage";
import {
  describeDue,
  describeRecurrence,
  leverageInWindow,
  scheduleBuckets,
  type ScheduledNode,
} from "@/lib/knowledge-schedule";
import { fitToCanvas, layeredLayout, layoutGraph, seedPositions } from "@/lib/graph-layout";
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
  units,
  materials,
  storageLocations,
  availableKits,
  canDelete,
  today,
}: {
  graph: Graph;
  tags: string[];
  /** Every unit this business measures in, built-in and home-made. */
  units: UnitOption[];
  /** Inventory, for linking a node to the real thing. */
  materials: MaterialOption[];
  /** What the inventory add forms need, so adding stock from here is the
   * same form as adding it on the Inventory page. */
  storageLocations: string[];
  availableKits: number[];
  canDelete: boolean;
  /** Worked out on the server, like every other date in this app, so the
   * page renders the same on both sides of hydration. */
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [filters, setFilters] = useState<GraphFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /**
   * Two ways of reading the same graph.
   *
   * The web answers "what is this business made of" — what clusters, what is
   * central. The breakdown answers "what does this idea need", which is a
   * different question and one a force layout is bad at: it will happily put
   * the cardstock above the flyers and leave nothing on screen saying which
   * needs which.
   */
  const [view, setView] = useState<"web" | "breakdown">("web");
  // Drags are kept per view. A node shoved aside on the web has no business
  // moving where it sits in the breakdown, which is a computed arrangement.
  const [moved, setMoved] = useState<{ web: Map<string, Point>; breakdown: Map<string, Point> }>({
    web: new Map(),
    breakdown: new Map(),
  });
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
  // Crossings supersede the old shallow list: this one follows the chain, so
  // two ideas that meet three levels down show up the same as two that both
  // say "printer" on their own screen.
  const crossed = useMemo(() => crossings(graph), [graph]);
  const summary = useMemo(() => leverageSummary(graph), [graph]);
  const suggestions = useMemo(() => provenEarners(graph), [graph]);
  const gaps = useMemo(() => notEarningYet(graph), [graph]);
  const orphans = useMemo(() => isolatedNodes(graph), [graph]);
  const buckets = useMemo(() => scheduleBuckets(graph.nodes, today), [graph.nodes, today]);
  const leverage = useMemo(() => leverageInWindow(graph, today, 30), [graph, today]);
  const dueCount = buckets.overdue.length + buckets.today.length + buckets.soon.length;

  // What the near-term schedule costs, materials and time kept apart. Shared
  // inputs are counted per idea on purpose: two campaigns both needing two
  // thousand sheets need four thousand sheets.
  const dueCost = useMemo(
    () =>
      costOfMany(
        graph,
        [...buckets.overdue, ...buckets.today, ...buckets.soon].map((b) => b.node.id)
      ),
    [graph, buckets]
  );

  // Anything already showing under "worth doing together" is left out here.
  // The same printer listed twice, once with dates and once without, reads as
  // two findings and is one.
  const scheduledResourceIds = useMemo(
    () => new Set(leverage.map((l) => l.resource.id)),
    [leverage]
  );
  const waiting = useMemo(
    () => crossed.filter((c) => !scheduledResourceIds.has(c.node.id)),
    [crossed, scheduledResourceIds]
  );
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

    if (view === "breakdown") {
      // Ideas are the top row. With none visible — filtered to materials, say
      // — whatever nothing points into stands in, so the arrangement still
      // reads downwards instead of collapsing into one line.
      const ideas = visible.nodes.filter((n) => n.nodeType === "idea").map((n) => n.id);
      const pointedAt = new Set(visible.edges.map((e) => e.targetId));
      const roots =
        ideas.length > 0
          ? ideas
          : visible.nodes.filter((n) => !pointedAt.has(n.id)).map((n) => n.id);

      const laid = layeredLayout(
        visible.nodes.map((node) => ({
          id: node.id,
          x: 0,
          y: 0,
          weight: 1 + (degrees.get(node.id) ?? 0) * 0.5,
        })),
        visible.edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId, strength: e.strength })),
        { width: size.width, height: size.height, roots }
      );

      return new Map<string, Point>(laid.map((n) => [n.id, { x: n.x, y: n.y }]));
    }

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
  }, [visible, degrees, size.width, size.height, view]);

  const positions = useMemo(() => {
    const merged = new Map(layout);
    for (const [id, point] of moved[view]) if (merged.has(id)) merged.set(id, point);
    return merged;
  }, [layout, moved, view]);

  const handleMeasure = useCallback((next: { width: number; height: number }) => {
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
  }, []);

  function handleMove(id: string, point: Point) {
    setMoved((current) => ({ ...current, [view]: new Map(current[view]).set(id, point) }));
  }

  function handleMoveEnd(id: string) {
    const point = positions.get(id);
    if (!point) return;
    // Only the web is a board somebody arranges. The breakdown is worked out
    // from the connections every time, so saving a position from it would
    // pin a node in a place that only made sense in the other view.
    if (view !== "web") return;
    // Fired and not awaited: the node is already under the finger that put it
    // there, and blocking a drop on a round trip is how a board feels heavy.
    void saveNodePositions([{ id, x: point.x, y: point.y }]);
  }

  function done(id: string) {
    start(async () => {
      const result = await markNodeDone(id);
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setView((v) => (v === "web" ? "breakdown" : "web"))}
        >
          {view === "web" ? "Breakdown" : "Web"}
        </Button>
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
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters.scheduledOnly}
                onChange={(e) => setFilters({ ...filters, scheduledOnly: e.target.checked })}
              />
              Scheduled only
            </label>
            <button
              type="button"
              className="underline text-muted-foreground"
              onClick={() =>
                setFilters({
                  ...EMPTY_FILTERS,
                  nodeTypes: new Set(),
                  statuses: new Set(),
                  relationshipTypes: new Set(),
                })
              }
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
        fitTo={layout}
        today={today}
      />

      <p className="mb-4 mt-1.5 text-[11px] text-muted-foreground">
        {view === "breakdown"
          ? "Ideas across the top, what they need on the row beneath, what those need under that. Worked out from the connections each time, so moving something here is just for a look — the web is the board that remembers."
          : "Drag to move a node, drag the background to pan, pinch or scroll to zoom, tap a node to open it, double-tap empty space to add one there."}{" "}
        Size is how many things touch it; a ring means it is scheduled, and amber means it has gone by.
      </p>

      {selected && (
        <div className="mb-4">
          <NodePanel
            key={selected.id}
            graph={graph}
            materials={materials}
            units={units}
            storageLocations={storageLocations}
            availableKits={availableKits}
            node={selected}
            canDelete={canDelete}
            onClose={() => setSelectedId(null)}
            onFocus={() => setFocusId(selected.id)}
            onSelect={(id) => setSelectedId(id)}
            onChanged={() => router.refresh()}
          />
        </div>
      )}

      {dueCount > 0 && (
        <div className="mb-4 rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
          <h2 className="text-lg font-bold">Coming up</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Ticking something off rolls a repeating idea forward on its own, so nothing has to be
            re-entered to keep happening.
          </p>
          {dueCost.total > 0 && (
            <p className="mb-3 text-xs">
              <span className="font-medium">{money(dueCost.total)}</span> and{" "}
              <span className="font-medium">{formatHours(dueCost.hours)}</span> to get through what is
              below.
              {dueCost.capital > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  Plus {money(dueCost.capital)} of kit ({dueCost.capitalItems.map((n) => n.title).join(", ")}),
                  bought once for all of it.
                </span>
              )}
              {dueCost.unpriced.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  Nothing priced yet on {dueCost.unpriced.map((n) => n.title).join(", ")}.
                </span>
              )}
            </p>
          )}
          <DueList
            label="Overdue"
            tone="alert"
            items={buckets.overdue}
            today={today}
            pending={pending}
            graph={graph}
            onSelect={setSelectedId}
            onDone={done}
          />
          <DueList
            label="Today"
            items={buckets.today}
            today={today}
            pending={pending}
            graph={graph}
            onSelect={setSelectedId}
            onDone={done}
          />
          <DueList
            label="This week"
            items={buckets.soon}
            today={today}
            pending={pending}
            graph={graph}
            onSelect={setSelectedId}
            onDone={done}
          />
          {buckets.later.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {buckets.later.length} more scheduled further out.
            </p>
          )}
        </div>
      )}

      {leverage.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
          <h2 className="text-lg font-bold">Worth doing together</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Scheduled inside the next month and leaning on the same thing. One print run instead of two,
            one setup, one delivery.
          </p>
          <ul className="flex flex-col gap-2">
            {leverage.map(({ resource, uses, totalQuantity, totalAmount }) => (
              <li key={resource.id} className="rounded-lg border border-border/60 p-2">
                <button type="button" onClick={() => setSelectedId(resource.id)} className="w-full text-left">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: nodeTypeDef(resource.nodeType).color }}
                    />
                    <span className="text-sm font-medium">{resource.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {totalQuantity != null
                        ? describeQuantity(totalQuantity, resource.unit)
                        : `${uses.length} times`}
                    </span>
                  </span>
                  {/* One order, one block of somebody's day, or one purchase
                      — three different kinds of leverage, and calling them all
                      "an order" would be wrong about two of them. */}
                  {isCapital(resource) && resource.estimatedCost != null ? (
                    <span className="mt-0.5 block text-xs font-medium">
                      {money(resource.estimatedCost)} once, earning its keep {uses.length} times
                    </span>
                  ) : totalAmount != null && totalQuantity != null ? (
                    <span className="mt-0.5 block text-xs font-medium">
                      {isTimeUnit(resource.unit)
                        ? `${describeQuantity(totalQuantity, resource.unit)} in one sitting — ${money(totalAmount)}`
                        : `${money(totalAmount)} in one order instead of ${uses.length}`}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {uses
                      .map(
                        (u) =>
                          `${u.node.title} (${describeDue(u.due, today)}${
                            u.quantity != null ? `, ${describeQuantity(u.quantity, resource.unit)}` : ""
                          })`
                      )
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
          <h2 className="text-lg font-bold">Where paths cross</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Every place two ideas end up needing the same thing — following the chain, not just the first
            step. The ones neither idea names directly come first, because those are the ones nobody could
            already see.
          </p>
          <ul className="flex flex-col gap-2">
            {waiting.map((crossing) => (
              <li key={crossing.node.id} className="rounded-lg border border-border/60 p-2">
                <button
                  type="button"
                  onClick={() => setSelectedId(crossing.node.id)}
                  className="w-full text-left"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: nodeTypeDef(crossing.node.nodeType).color }}
                    />
                    <span className="text-sm font-medium">{crossing.node.title}</span>
                    {crossing.indirect && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        hidden
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {crossing.totalAmount > 0
                        ? crossing.capital
                          ? `${money(crossing.totalAmount)} once`
                          : money(crossing.totalAmount)
                        : `${crossing.through.length} ideas`}
                    </span>
                  </span>
                  {/* The route matters more than the fact. "Door hangers →
                      print run → printer" is the sentence somebody acts on. */}
                  <span className="mt-1 block space-y-0.5">
                    {crossing.through.map((route) => (
                      <span key={route.idea.id} className="block text-[11px] text-muted-foreground">
                        {route.idea.title}
                        {route.path.length > 1
                          ? ` → ${route.path.slice(0, -1).map((n) => n.title).join(" → ")} →`
                          : " →"}{" "}
                        {crossing.node.title}
                        {route.quantity > 0 && !crossing.capital
                          ? ` (${describeQuantity(route.quantity, crossing.node.unit)})`
                          : ""}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Money, last, because it is the question to ask about everything
          above rather than a section of its own. */}
      {summary.totalIdeas > 0 && (summary.spending > 0 || summary.earning > 0) && (
        <div className="mb-4 rounded-xl border border-white/60 bg-card/70 p-4 backdrop-blur-md">
          <h2 className="text-lg font-bold">Making it pay</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {money(summary.spending)} going out, {money(summary.earning)} coming back across{" "}
            {summary.totalIdeas} idea{summary.totalIdeas === 1 ? "" : "s"} —{" "}
            {summary.earningIdeas} of them earning anything at all.
          </p>

          {suggestions.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-sm font-semibold">Already works here — would it work there?</p>
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <li key={s.revenue.id} className="rounded-lg border border-emerald-300/60 bg-emerald-50/50 p-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.couldAlsoEarn[0].id)}
                      className="w-full text-left"
                    >
                      <span className="block text-sm font-medium">{s.revenue.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        Earning on {s.earningFrom.map((n) => n.title).join(", ")}. Crosses paths with{" "}
                        {s.couldAlsoEarn.map((n) => n.title).join(", ")}, where nobody has asked yet.
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-semibold">Costs money, earns nothing yet</p>
              <ul className="flex flex-col gap-1.5">
                {gaps.slice(0, 6).map(({ idea, payback }) => (
                  <li key={idea.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(idea.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm">{idea.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {money(payback.cost.total)} a run
                        {payback.cost.hours > 0 ? `, ${formatHours(payback.cost.hours)}` : ""}
                      </span>
                    </button>
                    <span className="shrink-0 text-[11px] text-muted-foreground">no answer yet</span>
                  </li>
                ))}
              </ul>
              {gaps.length > 6 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  and {gaps.length - 6} more.
                </p>
              )}
            </div>
          )}
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

/**
 * One bucket of what is due.
 *
 * Marking done sits on the row rather than behind the node, because the whole
 * value of a recurring idea is that keeping it going costs one tap. Anything
 * more and the schedule quietly stops reflecting what actually happens.
 */
function DueList({
  label,
  items,
  today,
  pending,
  tone,
  graph,
  onSelect,
  onDone,
}: {
  label: string;
  items: ScheduledNode[];
  today: string;
  pending: boolean;
  tone?: "alert";
  graph: Graph;
  onSelect: (id: string) => void;
  onDone: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-3">
      <p className={`mb-1.5 text-xs font-semibold ${tone === "alert" ? "text-amber-700" : ""}`}>
        {label} ({items.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ node, due }) => {
          const own = costOf(graph, node.id);
          const cost =
            own.total > 0
              ? `${money(own.total)} a run${own.hours > 0 ? `, ${formatHours(own.hours)}` : ""}`
              : "";
          return (
          <li
            key={node.id}
            className={`flex items-center gap-2 rounded-lg border p-2 ${
              tone === "alert" ? "border-amber-400/70 bg-amber-50/60" : "border-border/60"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: nodeTypeDef(node.nodeType).color }}
            />
            <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm">{node.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {describeDue(due, today)} · {describeRecurrence(node.recurrence, node.recurrenceInterval)}
                {cost ? ` · ${cost}` : ""}
              </span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDone(node.id)}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px]"
            >
              Done
            </button>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
