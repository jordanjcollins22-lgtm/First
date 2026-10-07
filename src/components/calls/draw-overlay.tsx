"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDataChannel, useLocalParticipant } from "@livekit/components-react";
import { Eraser, Pencil, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A stroke's points are fractions of the overlay's box (0–1), not pixels, so
 * everyone sees the mark over the same spot regardless of window size. */
interface Stroke {
  id: string;
  author: string;
  color: string;
  points: { x: number; y: number }[];
}

type DrawEvent =
  | { type: "stroke"; stroke: Stroke }
  | { type: "undo"; author: string; strokeId: string }
  | { type: "clear" };

const TOPIC = "draw";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff"];

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x * width, point.y * height);
  }
  // A single tap has nowhere to draw a line to, so give it a visible dot.
  if (stroke.points.length === 1) {
    ctx.lineTo(stroke.points[0].x * width + 0.1, stroke.points[0].y * height);
  }
  ctx.stroke();
}

/**
 * A canvas laid over the call that everyone can draw on, synced through
 * LiveKit's data channel — the same connection carrying the video, so there's
 * no extra service to run. Undo removes your own last stroke; it can't undo
 * someone else's.
 */
export function DrawOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const currentStroke = useRef<Stroke | null>(null);

  const { localParticipant } = useLocalParticipant();
  const identity = localParticipant?.identity ?? "me";

  const { send } = useDataChannel(TOPIC, (message) => {
    try {
      const event = JSON.parse(new TextDecoder().decode(message.payload)) as DrawEvent;
      if (event.type === "stroke") {
        setStrokes((prev) => [...prev, event.stroke]);
      } else if (event.type === "undo") {
        setStrokes((prev) => prev.filter((s) => s.id !== event.strokeId));
      } else if (event.type === "clear") {
        setStrokes([]);
      }
    } catch {
      // A malformed payload shouldn't take the call down.
    }
  });

  const broadcast = useCallback(
    (event: DrawEvent) => {
      send?.(new TextEncoder().encode(JSON.stringify(event)), { reliable: true });
    },
    [send]
  );

  // Repaint whenever the strokes or the box size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function paint() {
      if (!canvas || !container) return;
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      for (const stroke of strokes) drawStroke(ctx, stroke, width, height);
      if (currentStroke.current) drawStroke(ctx, currentStroke.current, width, height);
    }

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(container);
    return () => observer.disconnect();
  }, [strokes, drawing]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    currentStroke.current = {
      id: `${identity}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: identity,
      color,
      points: [pointFrom(e)],
    };
    setDrawing(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!enabled || !currentStroke.current) return;
    currentStroke.current.points.push(pointFrom(e));
    // Nudge the paint effect without adding a finished stroke to state.
    setDrawing((v) => !v);
  }

  function handlePointerUp() {
    const stroke = currentStroke.current;
    currentStroke.current = null;
    setDrawing(false);
    if (!stroke || stroke.points.length === 0) return;
    setStrokes((prev) => [...prev, stroke]);
    broadcast({ type: "stroke", stroke });
  }

  function handleUndo() {
    // Your own last stroke only — undoing someone else's would be surprising.
    const mine = [...strokes].reverse().find((s) => s.author === identity);
    if (!mine) return;
    setStrokes((prev) => prev.filter((s) => s.id !== mine.id));
    broadcast({ type: "undo", author: identity, strokeId: mine.id });
  }

  function handleClear() {
    setStrokes([]);
    broadcast({ type: "clear" });
  }

  const myStrokeCount = strokes.filter((s) => s.author === identity).length;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn("h-full w-full", enabled ? "pointer-events-auto cursor-crosshair" : "pointer-events-none")}
      />

      <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/70 px-3 py-2 backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant={enabled ? "default" : "ghost"}
          onClick={() => setEnabled((v) => !v)}
          className={cn(!enabled && "text-white hover:text-white")}
        >
          <Pencil className="h-4 w-4" />
          {enabled ? "Drawing" : "Draw"}
        </Button>

        {enabled && (
          <>
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  aria-label={`Draw in ${c}`}
                  className={cn(
                    "h-5 w-5 rounded-full border-2",
                    color === c ? "border-white" : "border-transparent"
                  )}
                />
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleUndo}
              disabled={myStrokeCount === 0}
              className="text-white hover:text-white"
            >
              <Undo2 className="h-4 w-4" />
              Undo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={strokes.length === 0}
              className="text-white hover:text-white"
            >
              <Eraser className="h-4 w-4" />
              Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
