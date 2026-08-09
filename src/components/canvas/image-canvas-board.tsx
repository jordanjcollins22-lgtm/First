"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { v4 as uuid } from "uuid";
import jsPDF from "jspdf";
import {
  Download,
  ImageUp,
  Lock,
  MousePointer2,
  PenTool,
  Ruler,
  Satellite,
  Trash2,
  Unlock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { loadDesign, saveDesign, clearDesign } from "@/lib/canvas-storage";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { SatelliteAddressSearch } from "./satellite-address-search";
import { ZoneServiceDialog } from "./zone-service-dialog";
import { serviceTypeById } from "./service-catalog";
import { RENTAL_TOOLS, toolIcon } from "./tools-catalog";
import { zoneMaterialLineItems, formatMaterialQuantity, type MaterialLineItem } from "./materials-catalog";
import type { Point, WorkZone, ZoneServiceData } from "./types";

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 625;
const CLOSE_POINT_RADIUS = 12;
const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 = 156543.03392;
const METERS_TO_FEET = 3.28084;

// PDF page canvases, sized to match a US Letter page's aspect ratio (8.5x11).
const PAGE_WIDTH = 1000;
const PAGE_HEIGHT = Math.round((PAGE_WIDTH / 8.5) * 11);
const PAGE_MARGIN = 48;

interface CanvasImage {
  element: HTMLImageElement;
  blob: Blob;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Real-world feet spanned by the image's full native width, once known. */
  realWidthFeet: number | null;
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

/** Breaks an auto-scope sentence (or sentences) into ordered checklist steps. */
function splitScopeIntoSteps(scope: string): string[] {
  const sentences = scope.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  const steps: string[] = [];
  for (const sentence of sentences) {
    const withoutPeriod = sentence.replace(/\.$/, "");
    const parts = withoutPeriod
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      steps.push(part.charAt(0).toUpperCase() + part.slice(1));
    }
  }
  return steps;
}

function zoneServiceSummary(service: ZoneServiceData): string {
  return serviceTypeById(service.typeId)?.label ?? "Details added";
}

function displayFieldValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (value === "Other") {
    const explanation = values[`${key}__other`];
    return explanation ? `Other — ${explanation}` : "Other";
  }
  return value;
}

function polygonAreaPx(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function polygonPerimeterPx(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length]);
  }
  return sum;
}

function feetPerCanvasPixel(image: CanvasImage | null): number | null {
  if (!image || !image.realWidthFeet) return null;
  return image.realWidthFeet / (image.element.width * image.scale);
}

function zoneMeasurements(
  zone: WorkZone,
  image: CanvasImage | null
): { areaSqFt: number; perimeterFt: number } | null {
  if (zone.points.length < 3) return null;
  const fpp = feetPerCanvasPixel(image);
  if (!fpp) return null;
  return {
    areaSqFt: polygonAreaPx(zone.points) * fpp * fpp,
    perimeterFt: polygonPerimeterPx(zone.points) * fpp,
  };
}

function formatMeasurements(m: { areaSqFt: number; perimeterFt: number }): string {
  return `${Math.round(m.areaSqFt).toLocaleString()} sq ft · ${Math.round(m.perimeterFt).toLocaleString()} ft perimeter`;
}

function allToolsAcrossZones(zones: WorkZone[]): string[] {
  const set = new Set<string>();
  for (const zone of zones) {
    for (const tool of zone.service?.tools ?? []) set.add(tool);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderCoverPage(planCanvas: HTMLCanvasElement, address: string, tools: string[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  let y = PAGE_MARGIN;
  ctx.font = "700 30px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Site Plan", PAGE_MARGIN, y);
  y += 40;

  if (address.trim()) {
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(address.trim(), PAGE_MARGIN, y);
    y += 26;
  }
  y += 12;

  const mapWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const mapHeight = mapWidth * (planCanvas.height / planCanvas.width);
  ctx.drawImage(planCanvas, PAGE_MARGIN, y, mapWidth, mapHeight);
  y += mapHeight + 36;

  ctx.font = "700 20px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Tools to Grab", PAGE_MARGIN, y);
  y += 30;

  if (tools.length === 0) {
    ctx.font = "italic 15px sans-serif";
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("No tools listed yet.", PAGE_MARGIN, y);
  } else {
    ctx.font = "15px sans-serif";
    ctx.fillStyle = "#374151";
    const colWidth = (PAGE_WIDTH - PAGE_MARGIN * 2) / 2;
    const rowHeight = 26;
    const rowsPerColumn = Math.ceil(tools.length / 2);
    tools.forEach((tool, i) => {
      const col = Math.floor(i / rowsPerColumn);
      const row = i % rowsPerColumn;
      ctx.fillText(`☐ ${toolIcon(tool)} ${tool}`, PAGE_MARGIN + col * colWidth, y + row * rowHeight);
    });
  }

  return canvas;
}

async function renderZonePage(zone: WorkZone): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  ctx.font = "700 28px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText(zone.name, PAGE_MARGIN, y);
  y += 40;

  if (zone.location.trim()) {
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`📍 ${zone.location.trim()}`, PAGE_MARGIN, y);
    y += 26;
  }
  y += 8;

  const service = zone.service;
  const serviceType = service ? serviceTypeById(service.typeId) : undefined;

  if (service && serviceType) {
    ctx.font = "700 20px sans-serif";
    ctx.fillStyle = "#111827";
    ctx.fillText(serviceType.label, PAGE_MARGIN, y);
    y += 32;

    ctx.font = "15px sans-serif";
    ctx.fillStyle = "#374151";
    for (const field of serviceType.fields) {
      if (!service.values[field.key]) continue;
      const value = displayFieldValue(service.values, field.key);
      for (const line of wrapText(ctx, `${field.label}: ${value}`, maxWidth)) {
        ctx.fillText(line, PAGE_MARGIN, y);
        y += 22;
      }
    }
    y += 8;

    if ((service.tools?.length ?? 0) > 0) {
      ctx.font = "700 15px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText("Tools for this zone", PAGE_MARGIN, y);
      y += 22;
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#374151";
      const toolsText = service.tools.map((t) => `${toolIcon(t)} ${t}`).join(", ");
      for (const line of wrapText(ctx, toolsText, maxWidth)) {
        ctx.fillText(line, PAGE_MARGIN, y);
        y += 22;
      }
      y += 8;
    }

    if (serviceType.autoScope) {
      ctx.font = "700 15px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText("Checklist", PAGE_MARGIN, y);
      y += 26;
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#374151";
      for (const step of splitScopeIntoSteps(serviceType.autoScope(service.values))) {
        for (const line of wrapText(ctx, `☐ ${step}`, maxWidth)) {
          ctx.fillText(line, PAGE_MARGIN, y);
          y += 24;
        }
      }
      y += 8;
    }

    if (service.notes.trim()) {
      ctx.font = "700 15px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText("Notes", PAGE_MARGIN, y);
      y += 22;
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#374151";
      for (const line of wrapText(ctx, service.notes.trim(), maxWidth)) {
        ctx.fillText(line, PAGE_MARGIN, y);
        y += 22;
      }
      y += 8;
    }

    if (service.photos.length > 0) {
      const photoSize = 200;
      const gap = 16;
      const maxPhotos = Math.min(service.photos.length, 3);
      let x = PAGE_MARGIN;
      for (let i = 0; i < maxPhotos; i++) {
        try {
          const photoElement = await loadImageElement(service.photos[i]);
          ctx.drawImage(photoElement, x, y, photoSize, photoSize);
        } catch {
          // Skip a photo that fails to load rather than blocking the whole page.
        }
        x += photoSize + gap;
      }
      y += photoSize + 16;
      if (service.photos.length > maxPhotos) {
        ctx.font = "italic 13px sans-serif";
        ctx.fillStyle = "#6b7280";
        ctx.fillText(`+${service.photos.length - maxPhotos} more photo(s) on file`, PAGE_MARGIN, y);
      }
    }
  } else {
    ctx.font = "italic 16px sans-serif";
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("No service details added yet.", PAGE_MARGIN, y);
  }

  return canvas;
}

function renderMaterialsPage(
  zones: WorkZone[],
  image: CanvasImage | null,
  address: string
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  ctx.font = "700 26px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Materials & Rentals to Order", PAGE_MARGIN, y);
  y += 34;
  if (address.trim()) {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(address.trim(), PAGE_MARGIN, y);
    y += 24;
  }
  y += 12;

  const allItems: MaterialLineItem[] = [];
  for (const zone of zones) {
    const service = zone.service;
    if (!service) continue;
    const measurements = zoneMeasurements(zone, image);
    if (!measurements) continue;
    allItems.push(
      ...zoneMaterialLineItems(zone.id, zone.name, service.typeId, service.values, measurements.areaSqFt)
    );
  }

  ctx.font = "700 19px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Materials", PAGE_MARGIN, y);
  y += 28;

  if (allItems.length === 0) {
    ctx.font = "italic 14px sans-serif";
    ctx.fillStyle = "#9ca3af";
    for (const line of wrapText(
      ctx,
      "No bulk materials calculated yet — needs a zone with an automatically-scaled background and a material selected.",
      maxWidth
    )) {
      ctx.fillText(line, PAGE_MARGIN, y);
      y += 20;
    }
  } else {
    for (const item of allItems) {
      ctx.font = "700 14px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText(item.zoneName, PAGE_MARGIN, y);
      y += 19;
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "#374151";
      for (const line of wrapText(ctx, `☐ ${item.material}: ${formatMaterialQuantity(item)}`, maxWidth)) {
        ctx.fillText(line, PAGE_MARGIN, y);
        y += 20;
      }
      y += 6;
    }
  }

  y += 14;
  ctx.font = "700 19px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Equipment to Rent", PAGE_MARGIN, y);
  y += 28;

  const rentals = Array.from(
    new Set(zones.flatMap((zone) => (zone.service?.tools ?? []).filter((tool) => RENTAL_TOOLS.has(tool))))
  );
  if (rentals.length === 0) {
    ctx.font = "italic 14px sans-serif";
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("No rental equipment flagged for this job.", PAGE_MARGIN, y);
  } else {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#374151";
    for (const tool of rentals) {
      ctx.fillText(`☐ ${toolIcon(tool)} ${tool}`, PAGE_MARGIN, y);
      y += 22;
    }
  }

  return canvas;
}

interface JobPlanLine {
  text: string;
  font: string;
  color: string;
  indent: number;
}

function buildJobPlanTaskLines(zones: WorkZone[]): JobPlanLine[] {
  const lines: JobPlanLine[] = [];
  let step = 1;
  for (const zone of zones) {
    lines.push({
      text: zone.name + (zone.location.trim() ? ` — ${zone.location.trim()}` : ""),
      font: "700 15px sans-serif",
      color: "#111827",
      indent: 0,
    });
    const service = zone.service;
    const serviceType = service ? serviceTypeById(service.typeId) : undefined;
    if (service && serviceType?.autoScope) {
      for (const taskStep of splitScopeIntoSteps(serviceType.autoScope(service.values))) {
        lines.push({ text: `${step}. ${taskStep}`, font: "14px sans-serif", color: "#374151", indent: 16 });
        step++;
      }
    } else {
      lines.push({ text: "No service details added.", font: "italic 14px sans-serif", color: "#9ca3af", indent: 16 });
    }
  }
  return lines;
}

/** Paginates the whole-job task list so large jobs don't silently overflow one page. */
function renderJobPlanPages(zones: WorkZone[], image: CanvasImage | null, address: string): HTMLCanvasElement[] {
  const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) return [];

  const totalAreaSqFt = zones.reduce((sum, zone) => sum + (zoneMeasurements(zone, image)?.areaSqFt ?? 0), 0);
  const summary = `${zones.length} zone${zones.length === 1 ? "" : "s"}${
    totalAreaSqFt > 0 ? ` · ${Math.round(totalAreaSqFt).toLocaleString()} sq ft total` : ""
  }`;

  const headerLines: JobPlanLine[] = [
    { text: "Job Plan", font: "700 28px sans-serif", color: "#111827", indent: 0 },
    ...(address.trim() ? [{ text: address.trim(), font: "16px sans-serif", color: "#6b7280", indent: 0 }] : []),
    { text: summary, font: "15px sans-serif", color: "#374151", indent: 0 },
    { text: "Order of Work", font: "700 18px sans-serif", color: "#111827", indent: 0 },
  ];

  const wrapped: JobPlanLine[] = [];
  for (const line of [...headerLines, ...buildJobPlanTaskLines(zones)]) {
    mctx.font = line.font;
    for (const piece of wrapText(mctx, line.text, maxWidth - line.indent)) {
      wrapped.push({ ...line, text: piece });
    }
  }

  const LINE_HEIGHT = 24;
  const linesPerPage = Math.max(1, Math.floor((PAGE_HEIGHT - PAGE_MARGIN * 2) / LINE_HEIGHT));

  const pages: HTMLCanvasElement[] = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) {
    const chunk = wrapped.slice(i, i + linesPerPage);
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = PAGE_MARGIN;
    for (const line of chunk) {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, PAGE_MARGIN + line.indent, y);
      y += LINE_HEIGHT;
    }
    pages.push(canvas);
  }

  if (pages.length > 0) return pages;
  const fallback = document.createElement("canvas");
  fallback.width = PAGE_WIDTH;
  fallback.height = PAGE_HEIGHT;
  const fctx = fallback.getContext("2d");
  if (fctx) {
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  }
  return [fallback];
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
  const [address, setAddress] = useState("");
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [serviceDialogZoneId, setServiceDialogZoneId] = useState<string | null>(null);
  const [showSatelliteSearch, setShowSatelliteSearch] = useState(false);
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

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

    if (tool === "zone" && drawingPoints.length > 0) {
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

      const fpp = feetPerCanvasPixel(image);
      if (fpp) {
        let perimeterPx = 0;
        for (let i = 0; i < drawingPoints.length - 1; i++) {
          perimeterPx += distance(drawingPoints[i], drawingPoints[i + 1]);
        }
        if (cursorPos) perimeterPx += distance(drawingPoints[drawingPoints.length - 1], cursorPos);
        const perimeterFt = perimeterPx * fpp;

        const openPoints = cursorPos ? [...drawingPoints, cursorPos] : drawingPoints;
        const label =
          openPoints.length >= 3
            ? `${Math.round(polygonAreaPx(openPoints) * fpp * fpp).toLocaleString()} sq ft (open) · ${Math.round(perimeterFt).toLocaleString()} ft`
            : `${Math.round(perimeterFt).toLocaleString()} ft so far`;

        const anchor = cursorPos ?? drawingPoints[drawingPoints.length - 1];
        ctx.font = "600 13px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const textWidth = ctx.measureText(label).width;
        const boxX = anchor.x + 12;
        const boxY = anchor.y - 28;
        ctx.fillStyle = "rgba(17,24,39,0.85)";
        ctx.fillRect(boxX - 6, boxY - 4, textWidth + 12, 24);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, boxX, boxY);
      }
    }
  }, [image, zones, tool, drawingPoints, cursorPos]);

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
                realWidthFeet: design.imageRealWidthFeet ?? null,
              });
            }
          }
          if (!cancelled) {
            setLocked(design.locked);
            setAddress(design.address ?? "");
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
        imageRealWidthFeet: image?.realWidthFeet ?? null,
        locked,
        address,
        zones,
      })
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [image, locked, address, zones]);

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

  async function loadImageBlob(blob: Blob, realWidthFeet: number | null = null) {
    const element = await loadImageElement(blob);
    const scale = Math.min(
      (CANVAS_WIDTH * 0.9) / element.width,
      (CANVAS_HEIGHT * 0.9) / element.height,
      1
    );
    setImage({ element, blob, x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, scale, rotation: 0, realWidthFeet });
    setLocked(false);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadImageBlob(file);
    e.target.value = "";
  }

  async function fetchSatelliteImageBlob(
    lng: number,
    lat: number
  ): Promise<{ blob: Blob; realWidthFeet: number }> {
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

    // Web Mercator ground resolution at this zoom/latitude, applied to the
    // requested (unscaled) width, gives the real-world span of the image —
    // so measurements are ready automatically, with no manual calibration step.
    const metersPerPixel =
      (EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    const realWidthFeet = CANVAS_WIDTH * metersPerPixel * METERS_TO_FEET;

    return new Promise((resolve, reject) => {
      cropCanvas.toBlob((blob) => {
        if (!blob) reject(new Error("Couldn't process the satellite photo."));
        else resolve({ blob, realWidthFeet });
      }, "image/png");
    });
  }

  async function handleSelectSatelliteLocation(suggestion: GeocodeSuggestion) {
    setSatelliteError(null);
    setSatelliteLoading(true);
    try {
      const { blob, realWidthFeet } = await fetchSatelliteImageBlob(suggestion.lng, suggestion.lat);
      await loadImageBlob(blob, realWidthFeet);
      setAddress(suggestion.fullAddress);
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

  function handleScaleSliderChange(e: ChangeEvent<HTMLInputElement>) {
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

  async function handleExportPdf() {
    const planCanvas = canvasRef.current;
    if (!planCanvas) return;

    setExporting(true);
    try {
      const tools = allToolsAcrossZones(zones);
      const coverCanvas = renderCoverPage(planCanvas, address, tools);
      const materialsCanvas = renderMaterialsPage(zones, image, address);

      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const pageWidthPt = pdf.internal.pageSize.getWidth();
      const pageHeightPt = pdf.internal.pageSize.getHeight();

      // JPEG compresses these mostly-flat, opaque pages far better than PNG does
      // through jsPDF (which doesn't reuse PNG's own DEFLATE stream), keeping the
      // PDF a reasonable size to email or download.
      let firstPage = true;
      const addPageCanvas = (canvas: HTMLCanvasElement) => {
        if (!firstPage) pdf.addPage("letter", "portrait");
        firstPage = false;
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidthPt, pageHeightPt);
      };

      addPageCanvas(coverCanvas);
      addPageCanvas(materialsCanvas);

      for (const zone of zones) {
        addPageCanvas(await renderZonePage(zone));
      }

      for (const jobPlanCanvas of renderJobPlanPages(zones, image, address)) {
        addPageCanvas(jobPlanCanvas);
      }

      pdf.save("scope-of-work.pdf");
    } finally {
      setExporting(false);
    }
  }

  async function handleClearSavedDesign() {
    await clearDesign();
    setImage(null);
    setLocked(false);
    setAddress("");
    setZones([]);
    setDrawingPoints([]);
    setCursorPos(null);
    setLastSavedAt(null);
  }

  const maxScale = image ? Math.max(1, Math.min(4, (CANVAS_WIDTH * 2) / image.element.width)) : 1;
  const dialogZone = zones.find((zone) => zone.id === serviceDialogZoneId) ?? null;
  const dialogMeasurements = dialogZone ? zoneMeasurements(dialogZone, image) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Property address</span>
        <Input
          placeholder="123 Main St, City, ST"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

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
          <Button type="button" size="sm" variant="outline" disabled={exporting} onClick={handleExportPdf}>
            <Download className="h-4 w-4" />
            {exporting ? "Building PDF..." : "Export PDF"}
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

        {image?.realWidthFeet && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
            <Ruler className="h-3.5 w-3.5" />
            Auto-scaled
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {tool === "zone"
          ? "Click to add points. Click the first point (or press Enter) to close the zone. Backspace undoes a point, Escape cancels."
          : locked
            ? "The background is locked in place. Unlock it to reposition, rescale, or replace it."
            : "Drag the image to reposition it, use the scale slider to resize, then lock it in place before drawing zones."}
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
              onChange={handleScaleSliderChange}
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

        {(image || zones.length > 0) && (
          <Button type="button" variant="ghost" onClick={handleClearSavedDesign}>
            <Trash2 className="h-4 w-4" />
            Clear Saved Design
          </Button>
        )}
      </div>

      {image && !image.realWidthFeet && (
        <p className="text-xs text-muted-foreground">
          This background isn&apos;t scaled, so zone measurements aren&apos;t available. Use
          &ldquo;From Address&rdquo; for a satellite photo — its scale is set automatically.
        </p>
      )}

      {showSatelliteSearch && !locked && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
          <SatelliteAddressSearch onSelect={handleSelectSatelliteLocation} disabled={satelliteLoading} />
          {satelliteLoading && <p className="text-xs text-muted-foreground">Loading satellite photo...</p>}
          {satelliteError && <p className="text-xs text-destructive">{satelliteError}</p>}
          <p className="text-xs text-muted-foreground">
            Scale is calculated automatically from the satellite imagery, so zone measurements
            are ready right away.
          </p>
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
            {zones.map((zone) => {
              const measurements = zoneMeasurements(zone, image);
              return (
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
                      {measurements && (
                        <span className="text-xs text-muted-foreground">
                          {formatMeasurements(measurements)}
                        </span>
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
              );
            })}
          </ul>
        )}
      </div>

      <ZoneServiceDialog
        key={serviceDialogZoneId ?? "none"}
        open={dialogZone !== null}
        zoneName={dialogZone?.name ?? ""}
        measurementSummary={dialogMeasurements ? formatMeasurements(dialogMeasurements) : undefined}
        initialLocation={dialogZone?.location ?? ""}
        initialService={dialogZone?.service ?? null}
        onSave={handleSaveZoneService}
        onCancel={() => setServiceDialogZoneId(null)}
      />
    </div>
  );
}
