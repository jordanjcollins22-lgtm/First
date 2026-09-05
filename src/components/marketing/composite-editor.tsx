"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Move } from "lucide-react";

import { coverSlack, clamp, offsetDelta } from "@/lib/cover-placement";
import {
  AFTER_BOX,
  BEFORE_BOX,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CENTRED,
  drawComposite,
  loadPair,
  toBlob,
  type Nudge,
} from "@/lib/social-canvas";

interface CompositeEditorProps {
  beforeUrl: string;
  afterUrl: string;
  /** Handed the current file whenever the picture changes. */
  onChange: (blob: Blob | null) => void;
  onError: (message: string) => void;
}

/**
 * The square, draggable.
 *
 * Drawn straight onto a canvas rather than into a file and back out again, so
 * a drag redraws at once instead of making a PNG per frame. The file is taken
 * from this same canvas when it settles — what somebody dragged into place is
 * exactly what gets uploaded, not a second render of the same numbers.
 */
export function CompositeEditor({ beforeUrl, afterUrl, onChange, onError }: CompositeEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<{ before: HTMLImageElement; after: HTMLImageElement } | null>(null);
  const dragRef = useRef<{ half: "before" | "after"; x: number; y: number; from: Nudge } | null>(null);

  const [ready, setReady] = useState(false);
  const [beforeNudge, setBeforeNudge] = useState<Nudge>(CENTRED);
  const [afterNudge, setAfterNudge] = useState<Nudge>(CENTRED);

  const paint = useCallback(
    (nudges: { before: Nudge; after: Nudge }) => {
      const ctx = canvasRef.current?.getContext("2d");
      const images = imagesRef.current;
      if (!ctx || !images) return;
      drawComposite(ctx, images, { beforeNudge: nudges.before, afterNudge: nudges.after });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    loadPair(beforeUrl, afterUrl)
      .then((images) => {
        if (cancelled) return;
        imagesRef.current = images;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onError("One of the photos wouldn't load.");
      });

    return () => {
      cancelled = true;
    };
  }, [beforeUrl, afterUrl, onError]);

  // Repaint whenever anything moves, and hand the caller the new file.
  useEffect(() => {
    if (!ready) return;
    paint({ before: beforeNudge, after: afterNudge });

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    toBlob(canvas)
      .then((blob) => {
        if (!cancelled) onChange(blob);
      })
      .catch(() => {
        if (!cancelled) onChange(null);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, beforeNudge, afterNudge, paint, onChange]);

  /** Canvas coordinates from a pointer event, whatever size it is shown at. */
  function toCanvas(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    };
  }

  function handleDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const point = toCanvas(event);
    const half = point.y < BEFORE_BOX.height ? "before" : "after";
    dragRef.current = {
      half,
      x: point.x,
      y: point.y,
      from: half === "before" ? beforeNudge : afterNudge,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const images = imagesRef.current;
    if (!drag || !images) return;

    const point = toCanvas(event);
    const box = drag.half === "before" ? BEFORE_BOX : AFTER_BOX;
    const image = drag.half === "before" ? images.before : images.after;
    const slack = coverSlack(image.width, image.height, box.width, box.height);

    const next: Nudge = {
      x: clamp(drag.from.x + offsetDelta(point.x - drag.x, slack.x)),
      y: clamp(drag.from.y + offsetDelta(point.y - drag.y, slack.y)),
    };

    if (drag.half === "before") setBeforeNudge(next);
    else setAfterNudge(next);
  }

  function handleUp(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Compared by value, not identity: dragging always makes a new object, so
  // identity would go on offering Recentre to somebody who had already
  // dragged it back to the middle.
  const moved =
    beforeNudge.x !== 0 || beforeNudge.y !== 0 || afterNudge.x !== 0 || afterNudge.y !== 0;

  return (
    <div>
      <div
        className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-muted"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="h-full w-full touch-none"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Move className="h-3 w-3" />
          Drag either half to move the photo in its frame
        </span>
        {moved && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              setBeforeNudge(CENTRED);
              setAfterNudge(CENTRED);
            }}
          >
            Recentre
          </button>
        )}
      </div>
    </div>
  );
}
