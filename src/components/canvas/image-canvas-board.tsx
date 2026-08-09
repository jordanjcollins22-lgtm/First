"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { ImageUp, Lock, Trash2, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 625;

interface CanvasImage {
  element: HTMLImageElement;
  x: number;
  y: number;
  scale: number;
}

export function ImageCanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const [image, setImage] = useState<CanvasImage | null>(null);
  const [locked, setLocked] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (image) {
      const { element, x, y, scale } = image;
      const w = element.width * scale;
      const h = element.height * scale;
      ctx.drawImage(element, x - w / 2, y - h / 2, w, h);
    }
  }, [image]);

  useEffect(() => {
    draw();
  }, [draw]);

  function loadFile(file: File) {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      const scale = Math.min(
        (CANVAS_WIDTH * 0.9) / element.width,
        (CANVAS_HEIGHT * 0.9) / element.height,
        1
      );
      setImage({ element, x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, scale });
      setLocked(false);
      URL.revokeObjectURL(url);
    };
    element.src = url;
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = "";
  }

  function canvasPoint(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (locked || !image) return;
    const point = canvasPoint(e);
    dragRef.current = { startX: point.x, startY: point.y, originX: image.x, originY: image.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (locked || !dragRef.current || !image) return;
    const point = canvasPoint(e);
    setImage({
      ...image,
      x: dragRef.current.originX + (point.x - dragRef.current.startX),
      y: dragRef.current.originY + (point.y - dragRef.current.startY),
    });
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleScaleChange(e: ChangeEvent<HTMLInputElement>) {
    if (locked || !image) return;
    setImage({ ...image, scale: Number(e.target.value) });
  }

  function handleRemove() {
    setImage(null);
    setLocked(false);
  }

  const maxScale = image ? Math.max(1, Math.min(4, (CANVAS_WIDTH * 2) / image.element.width)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={cn("block w-full", !locked && image ? "cursor-move" : "cursor-default")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {!image && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Upload an image to get started
          </div>
        )}

        {locked && (
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
            <Lock className="h-3.5 w-3.5" />
            Locked
          </div>
        )}
      </div>

      {image && !locked && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Scale</span>
          <input
            type="range"
            min={0.1}
            max={maxScale}
            step={0.01}
            value={image.scale}
            onChange={handleScaleChange}
            className="flex-1"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={locked}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageUp className="h-4 w-4" />
          {image ? "Replace Image" : "Upload Image"}
        </Button>

        {image && (
          <Button type="button" variant={locked ? "outline" : "default"} onClick={() => setLocked((prev) => !prev)}>
            {locked ? (
              <>
                <Unlock className="h-4 w-4" />
                Unlock
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Lock Background
              </>
            )}
          </Button>
        )}

        {image && !locked && (
          <Button type="button" variant="ghost" onClick={handleRemove}>
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {locked
          ? "The image is locked in place. Unlock it to reposition, rescale, or replace it."
          : "Drag the image to reposition it and use the scale slider to resize, then lock it in place."}
      </p>
    </div>
  );
}
