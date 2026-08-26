"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { radiusFor } from "@/lib/graph-layout";
import { degreeMap, nodeTypeDef, relationshipDef, type Graph } from "@/lib/knowledge-graph";

export interface Point {
  x: number;
  y: number;
}

/**
 * The graph itself.
 *
 * Hand-drawn SVG rather than a canvas library: every node is a real element,
 * so a tap lands on it the way a tap lands on a button, and the browser does
 * the hit testing that a canvas would make us write.
 *
 * Positions are owned by the parent. The board is the thing somebody arranges
 * and expects to find the same way tomorrow, so the arrangement cannot live
 * inside a component that unmounts when a panel opens.
 */
export function GraphCanvas({
  graph,
  positions,
  selectedId,
  onSelect,
  onMove,
  onMoveEnd,
  onCreateAt,
  onMeasure,
  fitTo,
  today,
  height = "h-[58vh] min-h-[360px]",
}: {
  graph: Graph;
  positions: Map<string, Point>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, point: Point) => void;
  onMoveEnd: (id: string) => void;
  onCreateAt: (point: Point) => void;
  onMeasure: (size: { width: number; height: number }) => void;
  /**
   * The computed arrangement, before anybody dragged anything.
   *
   * The view is fitted to this rather than to what is on screen, so moving
   * one node does not re-fit — and therefore shift — every other node under
   * the finger that moved it.
   */
  fitTo: Map<string, Point>;
  /** Today, so a scheduled node can show whether it has gone by. */
  today: string;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Whatever the person has done with their fingers, on top of a fit worked
  // out from the layout. Kept separate so switching to a taller arrangement
  // re-fits on its own, and "Reset view" is just dropping this back to
  // nothing rather than guessing a scale.
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Drag and pan bookkeeping. Refs rather than state: these change on every
  // pointer move, and re-rendering the whole graph sixty times a second to
  // remember where a finger started is how dragging goes sticky.
  const dragRef = useRef<{ id: string; offset: Point } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchRef = useRef<{ distance: number; k: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const movedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width > 0 && next.height > 0) {
        setSize(next);
        onMeasure(next);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onMeasure]);

  const degrees = useMemo(() => degreeMap(graph), [graph]);

  /**
   * The scale that gets the whole arrangement on screen.
   *
   * Only ever zooms out. A three-node graph blown up to fill a phone looks
   * broken; a breakdown with eight things on a row that runs off both edges
   * is worse, because the parts you cannot see are the ones you did not know
   * to look for.
   */
  const fit = useMemo(() => {
    const points = [...fitTo.values()];
    if (points.length === 0 || !size.width || !size.height) return { k: 1, tx: 0, ty: 0 };

    const padding = 46;
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const k = Math.min(
      1,
      Math.max(0.25, (size.width - padding * 2) / spanX),
      Math.max(0.25, (size.height - padding * 2) / spanY)
    );

    return {
      k,
      tx: size.width / 2 - ((minX + maxX) / 2) * k,
      ty: size.height / 2 - ((minY + maxY) / 2) * k,
    };
  }, [fitTo, size.width, size.height]);

  // What is actually on screen: the fit, then whatever the person did to it.
  const k = fit.k * view.k;
  const tx = fit.tx * view.k + view.tx;
  const ty = fit.ty * view.k + view.ty;

  // What stays bright. Hovering or selecting a node dims everything it does
  // not touch, which is the whole way a dense graph becomes readable.
  const focus = useMemo(() => {
    const id = hoverId ?? selectedId;
    if (!id) return null;
    const set = new Set<string>([id]);
    for (const edge of graph.edges) {
      if (edge.sourceId === id) set.add(edge.targetId);
      if (edge.targetId === id) set.add(edge.sourceId);
    }
    return set;
  }, [graph.edges, hoverId, selectedId]);

  const toLogical = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - tx) / k,
        y: (clientY - rect.top - ty) / k,
      };
    },
    [tx, ty, k]
  );

  /** The slice of logical space currently on screen. */
  function visibleLogicalBounds() {
    return {
      left: -tx / k,
      top: -ty / k,
      width: (size.width || 1) / k,
      height: (size.height || 1) / k,
    };
  }

  function handlePointerDownNode(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const point = positions.get(id) ?? { x: 0, y: 0 };
    const cursor = toLogical(e.clientX, e.clientY);
    dragRef.current = { id, offset: { x: point.x - cursor.x, y: point.y - cursor.y } };
    movedRef.current = false;
  }

  function handlePointerMoveNode(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const cursor = toLogical(e.clientX, e.clientY);
    // Kept inside what is on screen rather than inside the canvas in pixels:
    // once the view is zoomed out those are different boxes, and clamping to
    // the wrong one makes a node lag behind the finger dragging it.
    const bounds = visibleLogicalBounds();
    const next = {
      x: clamp(cursor.x + drag.offset.x, bounds.left + 16, bounds.left + bounds.width - 16),
      y: clamp(cursor.y + drag.offset.y, bounds.top + 16, bounds.top + bounds.height - 16),
    };
    movedRef.current = true;
    onMove(drag.id, next);
  }

  function handlePointerUpNode(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    const moved = movedRef.current;
    dragRef.current = null;
    movedRef.current = false;
    // A tap that never moved is a tap, not a zero-pixel drag.
    if (moved) onMoveEnd(id);
    else onSelect(selectedId === id ? null : id);
  }

  function handleBackgroundDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      panRef.current = null;
      return;
    }
    panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }

  function handleBackgroundMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const pinch = pinchRef.current;
    if (pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(3, Math.max(0.3, (pinch.k * distance) / (pinch.distance || 1)));
      setView((v) => ({ ...v, k }));
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }));
  }

  function handleBackgroundUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    panRef.current = null;
  }

  function handleWheel(e: React.WheelEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    setView((v) => {
      const nextUserK = Math.min(3, Math.max(0.3, v.k * factor));
      const applied = nextUserK / v.k;
      // Zoom about the cursor, so the thing being looked at stays put. Done
      // on the effective transform and converted back, because the fit
      // underneath it is not the person's to move.
      const nextTx = px - (px - tx) * applied;
      const nextTy = py - (py - ty) * applied;
      return {
        k: nextUserK,
        tx: nextTx - fit.tx * nextUserK,
        ty: nextTy - fit.ty * nextUserK,
      };
    });
  }

  const showLabels = k >= 0.55 || graph.nodes.length <= 40;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`w-full overflow-hidden rounded-xl border border-white/60 bg-slate-950 ${height}`}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
          className="touch-none select-none"
          onPointerDown={handleBackgroundDown}
          onPointerMove={(e) => {
            handlePointerMoveNode(e);
            if (!dragRef.current) handleBackgroundMove(e);
          }}
          onPointerUp={handleBackgroundUp}
          onPointerCancel={handleBackgroundUp}
          onWheel={handleWheel}
          onDoubleClick={(e) => onCreateAt(toLogical(e.clientX, e.clientY))}
        >
          <defs>
            <marker
              id="kg-arrow-back"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 10 0 L 0 5 L 10 10 z" fill="#64748b" />
            </marker>
            <marker
              id="kg-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
            </marker>
          </defs>

          {/* A background target, so a drag on empty space pans rather than
              doing nothing wherever there happens to be no node. */}
          <rect
            width={size.width || 1}
            height={size.height || 1}
            fill="transparent"
            onPointerDown={() => onSelect(null)}
          />

          <g transform={`translate(${tx},${ty}) scale(${k})`}>
            {graph.edges.map((edge) => {
              const a = positions.get(edge.sourceId);
              const b = positions.get(edge.targetId);
              if (!a || !b) return null;
              const def = relationshipDef(edge.relationshipType);
              const lit = !focus || (focus.has(edge.sourceId) && focus.has(edge.targetId));

              // Both ends stop short of their circle, so an arrowhead sits
              // against the node rather than buried inside it — whichever end
              // it is on.
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const distance = Math.hypot(dx, dy) || 1;
              const targetRadius = radiusFor(degrees.get(edge.targetId) ?? 0);
              const sourceRadius = radiusFor(degrees.get(edge.sourceId) ?? 0);
              const startX = a.x + (dx / distance) * (sourceRadius + 3);
              const startY = a.y + (dy / distance) * (sourceRadius + 3);
              const endX = b.x - (dx / distance) * (targetRadius + 3);
              const endY = b.y - (dy / distance) * (targetRadius + 3);

              // "Job has cost fuel" is stored job → fuel because that is the
              // order the words go in, but the fuel goes into the job. The
              // arrowhead follows what moves, not what was typed first.
              const reversed = def.flowReversed === true;

              return (
                <g key={edge.id}>
                  <line
                    x1={reversed ? startX : a.x}
                    y1={reversed ? startY : a.y}
                    x2={endX}
                    y2={endY}
                    stroke={lit ? "#94a3b8" : "#334155"}
                    strokeWidth={0.7 + edge.strength * 0.35}
                    strokeOpacity={lit ? 0.85 : 0.25}
                    markerEnd={def.directional && !reversed ? "url(#kg-arrow)" : undefined}
                    markerStart={def.directional && reversed ? "url(#kg-arrow-back)" : undefined}
                  />
                  {/* A numbered step says what happens when, which a line on
                      its own cannot. */}
                  {edge.stepOrder != null && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 3}
                      textAnchor="middle"
                      fontSize={10}
                      fill={lit ? "#e2e8f0" : "#475569"}
                      style={{ pointerEvents: "none" }}
                    >
                      {edge.stepOrder}
                    </text>
                  )}
                </g>
              );
            })}

            {graph.nodes.map((node) => {
              const point = positions.get(node.id);
              if (!point) return null;
              const def = nodeTypeDef(node.nodeType);
              const degree = degrees.get(node.id) ?? 0;
              const radius = radiusFor(degree);
              const lit = !focus || focus.has(node.id);
              const selected = selectedId === node.id;

              return (
                <g
                  key={node.id}
                  opacity={lit ? 1 : 0.25}
                  onPointerDown={(e) => handlePointerDownNode(e, node.id)}
                  onPointerUp={(e) => handlePointerUpNode(e, node.id)}
                  onPointerEnter={() => setHoverId(node.id)}
                  onPointerLeave={() => setHoverId((h) => (h === node.id ? null : h))}
                  className="cursor-pointer"
                >
                  {/* An invisible pad so a 7px dot is still a thumb-sized
                      target on a phone. */}
                  <circle cx={point.x} cy={point.y} r={Math.max(radius + 10, 20)} fill="transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={radius}
                    fill={def.color}
                    stroke={selected ? "#ffffff" : "rgba(15,23,42,0.8)"}
                    strokeWidth={selected ? 3 : 1.5}
                  />
                  {node.status === "archived" && (
                    <circle cx={point.x} cy={point.y} r={radius} fill="#0f172a" fillOpacity={0.55} />
                  )}
                  {/* A ring means it is on the calendar, amber means it has
                      gone by. Scheduled work should be findable on the board
                      without reading every label. */}
                  {node.scheduledFor && (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={radius + 4}
                      fill="none"
                      stroke={node.scheduledFor < today ? "#f59e0b" : "#e2e8f0"}
                      strokeWidth={1.5}
                      strokeDasharray={node.recurrence === "none" ? "3 3" : undefined}
                    />
                  )}
                  {(showLabels || selected || degree >= 3) && (
                    <text
                      x={labelX(point.x, radius, size.width)}
                      y={point.y + radius + 12}
                      textAnchor={labelAnchor(point.x, size.width)}
                      fontSize={11}
                      fill={selected ? "#ffffff" : "#cbd5e1"}
                      style={{ pointerEvents: "none" }}
                    >
                      {node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 flex gap-1.5">
        <button
          type="button"
          className="pointer-events-auto rounded-md bg-slate-800/90 px-2 py-1 text-xs text-slate-100"
          onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.25) }))}
        >
          +
        </button>
        <button
          type="button"
          className="pointer-events-auto rounded-md bg-slate-800/90 px-2 py-1 text-xs text-slate-100"
          onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.25) }))}
        >
          −
        </button>
        <button
          type="button"
          className="pointer-events-auto rounded-md bg-slate-800/90 px-2 py-1 text-xs text-slate-100"
          onClick={() => setView({ k: 1, tx: 0, ty: 0 })}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

/**
 * Which way a label runs.
 *
 * Centred under the node everywhere except near the edges, where a centred
 * label is a label with half of it outside the box. A node against the left
 * edge reads its name to the right, and the other way on the right.
 */
function labelAnchor(x: number, width: number): "start" | "middle" | "end" {
  if (x < 70) return "start";
  if (width > 0 && x > width - 70) return "end";
  return "middle";
}

function labelX(x: number, radius: number, width: number): number {
  const anchor = labelAnchor(x, width);
  if (anchor === "start") return x - radius;
  if (anchor === "end") return x + radius;
  return x;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}
