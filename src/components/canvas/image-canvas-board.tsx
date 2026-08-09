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
import {
  Download,
  ImageUp,
  Lock,
  MousePointer2,
  PenTool,
  Satellite,
  Trash2,
  Unlock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { loadDesign, saveDesign, clearDesign } from "@/lib/canvas-storage";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { PLANT_DRAG_MIME, plantTypeById } from "./plant-types";
import { SatelliteAddressSearch } from "./satellite-address-search";
import { ZoneServiceDialog } from "./zone-service-dialog";
import { serviceTypeById } from "./service-catalog";
import type { PlacedPlant, Point, WorkZone, ZoneServiceData } from "./types";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 625;
const CLOSE_POINT_RADIUS = 12;
const PLANT_MARKER_RADIUS = 14;
const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

interface CanvasImage {
  element: HTMLImageElement;
  blob: Blob;
  x: number;
  y: number;
  scale: number;
  rotation: number;
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

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't load that image."));
    };
    element.src = url;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function zoneServiceSummary(service: ZoneServiceData): string {
  return serviceTypeById(service.typeId)?.label ?? "Details added";
}

function ZonePhotoThumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Object URLs must be created/revoked alongside the blob's lifecycle, so this
    // is a real external-system sync, not derivable state.
    const objectUrl = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />;
}

export function ImageCanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const loadedRef = useRef(false);

  const [image, setImage] = useState<CanvasImage | null>(null);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [plants, setPlants] = useState<PlacedPlant[]>([]);
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [serviceDialogZoneId, setServiceDialogZoneId] = useState<string | null>(null);
  const [showSatelliteSearch, setShowSatelliteSearch] = useState(false);
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (image) {
      const { element, x, y, scale, rotation } = image;
      const w = element.width * scale;
      const h = element.height * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(element, -w / 2, -h / 2, w, h);
      ctx.restore();
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

  // Restore a previously autosaved design from this browser once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const design = await loadDesign();
        if (!cancelled && design) {
          if (design.imageBlob) {
            const element = await loadImageElement(design.imageBlob);
            if (!cancelled) {
              setImage({
                element,
                blob: design.imageBlob,
                x: design.imageX,
                y: design.imageY,
                scale: design.imageScale,
                rotation: design.imageRotation ?? 0,
              });
            }
          }
          if (!cancelled) {
            setLocked(design.locked);
            setPlants(design.plants);
            setZones(design.zones);
          }
        }
      } catch {
        // No saved design (or it failed to load) — start from a blank canvas.
      } finally {
        loadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced autosave to this browser's storage whenever the design changes.
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      saveDesign({
        imageBlob: image?.blob ?? null,
        imageX: image?.x ?? CANVAS_WIDTH / 2,
        imageY: image?.y ?? CANVAS_HEIGHT / 2,
        imageScale: image?.scale ?? 1,
        imageRotation: image?.rotation ?? 0,
        locked,
        plants,
        zones,
      })
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [image, locked, plants, zones]);

  function finalizeZone() {
    if (drawingPoints.length < 3) return;
    const points = drawingPoints;
    const id = uuid();
    setZones((prev) => [
      ...prev,
      {
        id,
        name: `Zone ${prev.length + 1}`,
        color: ZONE_COLORS[prev.length % ZONE_COLORS.length],
        points,
        location: "",
        service: null,
      },
    ]);
    setDrawingPoints([]);
    setCursorPos(null);
    setServiceDialogZoneId(id);
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

  async function loadImageBlob(blob: Blob) {
    const element = await loadImageElement(blob);
    const scale = Math.min(
      (CANVAS_WIDTH * 0.9) / element.width,
      (CANVAS_HEIGHT * 0.9) / element.height,
      1
    );
    setImage({ element, blob, x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, scale, rotation: 0 });
    setLocked(false);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadImageBlob(file);
    e.target.value = "";
  }

  async function fetchSatelliteImageBlob(lng: number, lat: number): Promise<Blob> {
    // Mapbox requires its logo/attribution on static images, anchored to the bottom
    // edge. Fetch a bit more area than we need (zoomed out slightly, plus extra
    // vertical padding) so we can crop the bottom strip back off without losing
    // meaningful coverage of the property.
    const zoom = 18.7;
    const padding = 130;
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0/${CANVAS_WIDTH}x${CANVAS_HEIGHT + padding}@2x?access_token=${env.mapboxToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't load a satellite photo for that address.");
    const rawBlob = await res.blob();
    const rawImage = await loadImageElement(rawBlob);

    const pixelRatio = rawImage.width / CANVAS_WIDTH;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = CANVAS_WIDTH * pixelRatio;
    cropCanvas.height = CANVAS_HEIGHT * pixelRatio;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) throw new Error("Couldn't process the satellite photo.");
    cropCtx.drawImage(rawImage, 0, 0, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

    return new Promise((resolve, reject) => {
      cropCanvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process the satellite photo."))),
        "image/png"
      );
    });
  }

  async function handleSelectSatelliteLocation(suggestion: GeocodeSuggestion) {
    setSatelliteError(null);
    setSatelliteLoading(true);
    try {
      const blob = await fetchSatelliteImageBlob(suggestion.lng, suggestion.lat);
      await loadImageBlob(blob);
      setShowSatelliteSearch(false);
    } catch (err) {
      setSatelliteError(err instanceof Error ? err.message : "Couldn't load a satellite photo.");
    } finally {
      setSatelliteLoading(false);
    }
  }

  function selectTool(next: Tool) {
    setTool(next);
    setDrawingPoints([]);
    setCursorPos(null);
  }

  function handleDeleteZone(id: string) {
    setZones((prev) => prev.filter((zone) => zone.id !== id));
  }

  function handleSaveZoneService(location: string, service: ZoneServiceData | null) {
    setZones((prev) =>
      prev.map((zone) => (zone.id === serviceDialogZoneId ? { ...zone, location, service } : zone))
    );
    setServiceDialogZoneId(null);
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

  function handleRotationChange(e: ChangeEvent<HTMLInputElement>) {
    if (locked || !image) return;
    setImage({ ...image, rotation: Number(e.target.value) });
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

  async function handleExportImage() {
    const planCanvas = canvasRef.current;
    if (!planCanvas) return;

    if (zones.length === 0) {
      planCanvas.toBlob((blob) => blob && downloadBlob(blob, "work-zone-plan.png"), "image/png");
      return;
    }

    const MARGIN = 32;
    const PHOTO_SIZE = 110;
    const GAP = 16;
    const TITLE_HEIGHT = 48;
    const ZONE_GAP = 24;
    const LINE_HEIGHT = 20;
    const textMaxWidth = CANVAS_WIDTH - MARGIN * 2 - PHOTO_SIZE - GAP;

    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    if (!mctx) return;

    const zonePhotos = new Map<string, HTMLImageElement>();
    for (const zone of zones) {
      const firstPhoto = zone.service?.photos?.[0];
      if (!firstPhoto) continue;
      try {
        zonePhotos.set(zone.id, await loadImageElement(firstPhoto));
      } catch {
        // Skip a photo that fails to load rather than blocking the whole export.
      }
    }

    interface ZoneLine {
      text: string;
      font: string;
      color: string;
    }
    interface ZoneBlock {
      zone: WorkZone;
      lines: ZoneLine[];
      height: number;
    }

    const blocks: ZoneBlock[] = zones.map((zone) => {
      const lines: ZoneLine[] = [{ text: zone.name, font: "700 16px sans-serif", color: "#111827" }];

      mctx.font = "13px sans-serif";
      if (zone.location.trim()) {
        for (const line of wrapText(mctx, `Location: ${zone.location.trim()}`, textMaxWidth)) {
          lines.push({ text: line, font: "13px sans-serif", color: "#374151" });
        }
      }

      const service = zone.service;
      const serviceType = service ? serviceTypeById(service.typeId) : undefined;

      if (service && serviceType) {
        lines.push({ text: serviceType.label, font: "700 13px sans-serif", color: "#111827" });

        for (const field of serviceType.fields) {
          const value = service.values[field.key];
          if (!value) continue;
          for (const line of wrapText(mctx, `${field.label}: ${value}`, textMaxWidth)) {
            lines.push({ text: line, font: "13px sans-serif", color: "#374151" });
          }
        }

        if (serviceType.autoScope) {
          for (const line of wrapText(mctx, serviceType.autoScope(service.values), textMaxWidth)) {
            lines.push({ text: line, font: "italic 12px sans-serif", color: "#6b7280" });
          }
        }

        if (service.notes.trim()) {
          for (const line of wrapText(mctx, `Notes: ${service.notes.trim()}`, textMaxWidth)) {
            lines.push({ text: line, font: "13px sans-serif", color: "#374151" });
          }
        }

        if ((service.photos?.length ?? 0) > 1) {
          const more = service.photos.length - 1;
          lines.push({
            text: `+${more} more photo${more === 1 ? "" : "s"} on file`,
            font: "italic 12px sans-serif",
            color: "#6b7280",
          });
        }
      } else {
        lines.push({ text: "No service details added yet.", font: "italic 13px sans-serif", color: "#9ca3af" });
      }

      const height = Math.max(PHOTO_SIZE, lines.length * LINE_HEIGHT) + 20;
      return { zone, lines, height };
    });

    const scopeHeight = TITLE_HEIGHT + blocks.reduce((sum, b) => sum + b.height + ZONE_GAP, 0) + MARGIN;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT + scopeHeight;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(planCanvas, 0, 0);

    let cursorY = CANVAS_HEIGHT + MARGIN;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#111827";
    ctx.font = "700 22px sans-serif";
    ctx.fillText("Scope of Work", MARGIN, cursorY);
    cursorY += TITLE_HEIGHT;

    for (const block of blocks) {
      const blockTop = cursorY;
      const photo = zonePhotos.get(block.zone.id);

      if (photo) {
        ctx.drawImage(photo, MARGIN, blockTop, PHOTO_SIZE, PHOTO_SIZE);
      }

      const textX = MARGIN + (photo ? PHOTO_SIZE + GAP : 0);
      let lineY = blockTop;
      for (const line of block.lines) {
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, textX, lineY);
        lineY += LINE_HEIGHT;
      }

      cursorY = blockTop + block.height + ZONE_GAP;
    }

    exportCanvas.toBlob((blob) => blob && downloadBlob(blob, "work-zone-plan.png"), "image/png");
  }

  async function handleClearSavedDesign() {
    await clearDesign();
    setImage(null);
    setLocked(false);
    setPlants([]);
    setZones([]);
    setDrawingPoints([]);
    setCursorPos(null);
    setLastSavedAt(null);
  }

  const maxScale = image ? Math.max(1, Math.min(4, (CANVAS_WIDTH * 2) / image.element.width)) : 1;
  const dialogZone = zones.find((zone) => zone.id === serviceDialogZoneId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2">
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

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={handleExportImage}>
            <Download className="h-4 w-4" />
            Save Image
          </Button>
          {lastSavedAt && (
            <span className="text-xs text-muted-foreground">Autosaved in this browser</span>
          )}
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-muted-foreground">Scale</span>
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
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-muted-foreground">Rotate</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={image.rotation}
              onChange={handleRotationChange}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
              {image.rotation}°
            </span>
          </div>
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

        <Button
          type="button"
          variant="secondary"
          disabled={locked}
          onClick={() => setShowSatelliteSearch((prev) => !prev)}
        >
          <Satellite className="h-4 w-4" />
          From Address
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

        {(image || plants.length > 0 || zones.length > 0) && (
          <Button type="button" variant="ghost" onClick={handleClearSavedDesign}>
            <Trash2 className="h-4 w-4" />
            Clear Saved Design
          </Button>
        )}
      </div>

      {showSatelliteSearch && !locked && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
          <SatelliteAddressSearch onSelect={handleSelectSatelliteLocation} disabled={satelliteLoading} />
          {satelliteLoading && <p className="text-xs text-muted-foreground">Loading satellite photo...</p>}
          {satelliteError && <p className="text-xs text-destructive">{satelliteError}</p>}
        </div>
      )}

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
                <button
                  type="button"
                  onClick={() => setServiceDialogZoneId(zone.id)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: zone.color }}
                    aria-hidden
                  />
                  {zone.service?.photos?.[0] && <ZonePhotoThumbnail blob={zone.service.photos[0]} />}
                  <span className="flex flex-col">
                    <span className="font-medium">{zone.name}</span>
                    {zone.location && (
                      <span className="text-xs text-muted-foreground">📍 {zone.location}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {zone.service ? zoneServiceSummary(zone.service) : "Add service details"}
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleDeleteZone(zone.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ZoneServiceDialog
        key={serviceDialogZoneId ?? "none"}
        open={dialogZone !== null}
        zoneName={dialogZone?.name ?? ""}
        initialLocation={dialogZone?.location ?? ""}
        initialService={dialogZone?.service ?? null}
        onSave={handleSaveZoneService}
        onCancel={() => setServiceDialogZoneId(null)}
      />
    </div>
  );
}
