"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
} from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Lock, MousePointer2, PenTool, Trash2, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PLANT_DRAG_MIME, plantTypeById } from "./plant-types";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 625;
const CLOSE_POINT_RADIUS = 12;
const PLANT_MARKER_RADIUS = 14;
const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

interface Point {
  x: number;
  y: number;
}

interface CanvasImage {
  element: HTMLImageElement;
  x: number;
  y: number;
  scale: number;
}

interface PlacedPlant extends Point {
  id: string;
  typeId: string;
}

interface WorkZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
}

type Tool = "move" | "zone";

function toCanvasPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (CANVAS_WIDTH / rect.width),
    y: (clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ImageCanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const [image, setImage] = useState<CanvasImage | null>(null);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [plants, setPlants] = useState<PlacedPlant[]>([]);
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

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

    for (const zone of zones) {
      if (zone.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(zone.points[0].x, zone.points[0].y);
      for (const point of zone.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fillStyle = `${zone.color}33`;
      ctx.fill();
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      const cx = zone.points.reduce((sum, p) => sum + p.x, 0) / zone.points.length;
      const cy = zone.points.reduce((sum, p) => sum + p.y, 0) / zone.points.length;
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(zone.name, cx, cy);
      ctx.fillStyle = "#111827";
      ctx.fillText(zone.name, cx, cy);
    }

    if (drawingPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y);
      for (const point of drawingPoints.slice(1)) ctx.lineTo(point.x, point.y);
      if (cursorPos) ctx.lineTo(cursorPos.x, cursorPos.y);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const [i, point] of drawingPoints.entries()) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, i === 0 && drawingPoints.length >= 3 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#16a34a" : "#2563eb";
        ctx.fill();
      }
    }

    for (const plant of plants) {
      const type = plantTypeById(plant.typeId);
      if (!type) continue;
      ctx.beginPath();
      ctx.arc(plant.x, plant.y, PLANT_MARKER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(type.emoji, plant.x, plant.y);
    }
  }, [image, zones, drawingPoints, cursorPos, plants]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Reads drawingPoints/zones from render-time closures (not a setState updater),
  // so it's never subject to StrictMode's double-invocation of updater functions.
  function finalizeZone() {
    if (drawingPoints.length < 3) return;
    const points = drawingPoints;
    setZones((prev) => [
      ...prev,
      {
        id: uuid(),
        name: `Zone ${prev.length + 1}`,
        color: ZONE_COLORS[prev.length % ZONE_COLORS.length],
        points,
      },
    ]);
    setDrawingPoints([]);
    setCursorPos(null);
  }

  useEffect(() => {
    if (tool !== "zone") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawingPoints([]);
        setCursorPos(null);
      } else if (e.key === "Enter") {
        finalizeZone();
      } else if (e.key === "Backspace") {
        setDrawingPoints((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // finalizeZone reads drawingPoints/zones directly, so this effect must re-bind
    // whenever they change to avoid acting on a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, drawingPoints, zones]);

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

  function selectTool(next: Tool) {
    setTool(next);
    setDrawingPoints([]);
    setCursorPos(null);
  }

  function handleDeleteZone(id: string) {
    setZones((prev) => prev.filter((zone) => zone.id !== id));
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const point = toCanvasPoint(e.clientX, e.clientY, canvas);

    if (tool === "zone") {
      if (drawingPoints.length >= 3 && distance(point, drawingPoints[0]) <= CLOSE_POINT_RADIUS) {
        finalizeZone();
      } else {
        setDrawingPoints((prev) => [...prev, point]);
      }
      return;
    }

    const hitPlant = [...plants].reverse().find((plant) => distance(plant, point) <= PLANT_MARKER_RADIUS);
    if (hitPlant) {
      setPlants((prev) => prev.filter((p) => p.id !== hitPlant.id));
      return;
    }

    if (locked || !image) return;
    dragRef.current = { startX: point.x, startY: point.y, originX: image.x, originY: image.y };
    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const point = toCanvasPoint(e.clientX, e.clientY, e.currentTarget);

    if (tool === "zone") {
      if (drawingPoints.length > 0) setCursorPos(point);
      return;
    }

    if (locked || !dragRef.current || !image) return;
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

  function handleRemoveImage() {
    setImage(null);
    setLocked(false);
  }

  function handleDragOver(e: DragEvent<HTMLCanvasElement>) {
    if (e.dataTransfer.types.includes(PLANT_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(e: DragEvent<HTMLCanvasElement>) {
    const typeId = e.dataTransfer.getData(PLANT_DRAG_MIME);
    if (!typeId) return;
    e.preventDefault();
    const point = toCanvasPoint(e.clientX, e.clientY, e.currentTarget);
    setPlants((prev) => [...prev, { id: uuid(), typeId, x: point.x, y: point.y }]);
  }

  const maxScale = image ? Math.max(1, Math.min(4, (CANVAS_WIDTH * 2) / image.element.width)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          <Button
            type="button"
            size="sm"
            variant={tool === "move" ? "default" : "ghost"}
            onClick={() => selectTool("move")}
          >
            <MousePointer2 className="h-4 w-4" />
            Move
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "zone" ? "default" : "ghost"}
            onClick={() => selectTool("zone")}
          >
            <PenTool className="h-4 w-4" />
            Draw Work Zone
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={cn(
            "block w-full",
            tool === "zone" ? "cursor-crosshair" : !locked && image ? "cursor-move" : "cursor-default"
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
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

      <p className="text-xs text-muted-foreground">
        {tool === "zone"
          ? "Click to add points. Click the first point (or press Enter) to close the zone. Backspace undoes a point, Escape cancels."
          : locked
            ? "The background is locked in place. Unlock it to reposition, rescale, or replace it. Click a plant to remove it."
            : "Drag the image to reposition it, use the scale slider to resize, then lock it in place before adding plants and zones."}
      </p>

      {image && !locked && tool === "move" && (
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
          <Button type="button" variant="ghost" onClick={handleRemoveImage}>
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold">Work Zones</h2>
        {zones.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No work zones yet. Select &ldquo;Draw Work Zone&rdquo; and click points on the canvas to outline one.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {zones.map((zone) => (
              <li
                key={zone.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: zone.color }}
                    aria-hidden
                  />
                  {zone.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDeleteZone(zone.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
