"use client";

import { useRef, useState } from "react";

import type { SlotBox } from "@/lib/merch/template";

/** Drag on the image to mark where the barcode goes. */
export function SlotPicker({
  src,
  width,
  height,
  box,
  onChange,
}: {
  src: string;
  width: number;
  height: number;
  box: SlotBox | null;
  onChange: (box: SlotBox) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  function toImage(e: React.PointerEvent) {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, ((e.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((e.clientY - rect.top) / rect.height) * height)),
    };
  }

  function update(e: React.PointerEvent) {
    if (!start) return;
    const p = toImage(e);
    const next = {
      x: Math.round(Math.min(start.x, p.x)),
      y: Math.round(Math.min(start.y, p.y)),
      width: Math.round(Math.abs(p.x - start.x)),
      height: Math.round(Math.abs(p.y - start.y)),
    };
    if (next.width > 4 && next.height > 4) onChange(next);
  }

  return (
    <div
      ref={ref}
      className="relative max-w-xl cursor-crosshair touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setStart(toImage(e));
      }}
      onPointerMove={update}
      onPointerUp={(e) => {
        update(e);
        setStart(null);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Uploaded design" draggable={false} className="h-auto w-full rounded-md border border-border" />
      {box && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/20"
          style={{
            left: `${(box.x / width) * 100}%`,
            top: `${(box.y / height) * 100}%`,
            width: `${(box.width / width) * 100}%`,
            height: `${(box.height / height) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
