"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { computeJourneyLayout } from "@/lib/journey-layout";
import { STEP_TYPE_LABELS, STEP_TYPE_STYLES } from "@/lib/journey-metrics";
import type { JourneyStep } from "@/types/domain";

interface Point {
  x: number;
  y: number;
}

interface LinePath {
  key: string;
  d: string;
  dashed: boolean;
}

export function JourneyTree({
  steps,
  selectedKey,
  onSelectStep,
}: {
  steps: JourneyStep[];
  selectedKey: string | null;
  onSelectStep: (stepKey: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [paths, setPaths] = useState<LinePath[]>([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const { columns, forwardEdges, backEdges } = computeJourneyLayout(steps);
  const selfLoops = new Set(backEdges.filter((e) => e.from === e.to).map((e) => e.from));
  const loopBacks = backEdges.filter((e) => e.from !== e.to);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const containerRect = containerEl.getBoundingClientRect();
      const scrollLeft = containerEl.scrollLeft;
      const scrollTop = containerEl.scrollTop;

      function anchor(key: string, side: "left" | "right"): Point | null {
        const el = nodeRefs.current.get(key);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: (side === "right" ? rect.right : rect.left) - containerRect.left + scrollLeft,
          y: rect.top + rect.height / 2 - containerRect.top + scrollTop,
        };
      }

      const nextPaths: LinePath[] = [];
      for (const edge of forwardEdges) {
        const from = anchor(edge.from, "right");
        const to = anchor(edge.to, "left");
        if (!from || !to) continue;
        const midX = (from.x + to.x) / 2;
        nextPaths.push({
          key: `f-${edge.from}-${edge.to}`,
          d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
          dashed: false,
        });
      }
      for (const edge of loopBacks) {
        const from = anchor(edge.from, "left");
        const to = anchor(edge.to, "left");
        if (!from || !to) continue;
        const loopX = Math.min(from.x, to.x) - 28;
        nextPaths.push({
          key: `b-${edge.from}-${edge.to}`,
          d: `M ${from.x} ${from.y} C ${loopX} ${from.y}, ${loopX} ${to.y}, ${to.x} ${to.y}`,
          dashed: true,
        });
      }
      setPaths(nextPaths);
      setSvgSize({ width: containerEl.scrollWidth, height: containerEl.scrollHeight });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  return (
    <div ref={containerRef} className="relative overflow-x-auto rounded-lg border border-border bg-muted/20 p-6">
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={svgSize.width}
        height={svgSize.height}
        style={{ overflow: "visible" }}
      >
        {paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray={path.dashed ? "4 3" : undefined}
            className="text-muted-foreground/50"
            markerEnd="url(#journey-arrow)"
          />
        ))}
        <defs>
          <marker id="journey-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground/50" />
          </marker>
        </defs>
      </svg>

      <div className="relative flex items-start gap-10">
        {columns.map((column, i) => (
          <div key={i} className="flex min-w-44 flex-col gap-6">
            {column.map((step) => (
              <button
                key={step.step_key}
                type="button"
                ref={(el) => {
                  if (el) nodeRefs.current.set(step.step_key, el);
                  else nodeRefs.current.delete(step.step_key);
                }}
                onClick={() => onSelectStep(step.step_key)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border-2 bg-card px-3 py-2 text-left shadow-sm transition-colors",
                  selectedKey === step.step_key ? "border-primary" : "border-border hover:border-primary/50"
                )}
              >
                <span className="text-sm font-medium leading-tight">{step.label}</span>
                <div className="flex flex-wrap items-center gap-1">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0 text-[9px] font-semibold tracking-wide",
                      STEP_TYPE_STYLES[step.step_type]
                    )}
                  >
                    {STEP_TYPE_LABELS[step.step_type]}
                  </span>
                  {selfLoops.has(step.step_key) && (
                    <span className="text-[10px] text-muted-foreground" title="Can repeat">
                      ↻ repeats
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
