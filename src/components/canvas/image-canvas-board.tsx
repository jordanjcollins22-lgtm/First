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
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Home,
  ImageUp,
  Lock,
  Maximize2,
  Minimize2,
  MousePointer2,
  PenTool,
  Route,
  Ruler,
  Satellite,
  Trash2,
  Undo2,
  Unlock,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { loadDesign, saveDesign, clearDesign } from "@/lib/canvas-storage";
import { createClient } from "@/lib/supabase/client";
import { saveCanvasDesign } from "@/lib/actions/canvas-design-actions";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { SatelliteAddressSearch } from "./satellite-address-search";
import { ZoneServiceDialog } from "./zone-service-dialog";
import { serviceTypeById, type ServiceFieldDef } from "./service-catalog";
import type { Point, WorkZone, ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;
const CLOSE_POINT_RADIUS = 12;
const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 = 156543.03392;
const METERS_TO_FEET = 3.28084;
const CUBIC_FEET_PER_YARD = 27;
// Typical loaded wheelbarrow capacity used for hauling estimates.
const WHEELBARROW_CUBIC_FEET = 3;

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

type Tool = "move" | "zone" | "property-line" | "house";

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

// Cached across a single PDF export (and reused between exports in the same
// session) so the same tool/material photo isn't re-fetched for every zone it
// appears in.
const inventoryImageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadInventoryImage(
  bucket: "tool-images" | "material-images" | "canvas-images",
  path: string | null
): Promise<HTMLImageElement | null> {
  if (!path) return Promise.resolve(null);
  const key = `${bucket}:${path}`;
  let cached = inventoryImageCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const supabase = createClient();
        const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
        const res = await fetch(url);
        if (!res.ok) return null;
        return await loadImageElement(await res.blob());
      } catch {
        return null;
      }
    })();
    inventoryImageCache.set(key, cached);
  }
  return cached;
}

function toolImageFor(name: string, catalog: CanvasCatalog): Promise<HTMLImageElement | null> {
  return loadInventoryImage("tool-images", catalog.tools.find((t) => t.name === name)?.image_path ?? null);
}

function materialImageFor(materialId: string, catalog: CanvasCatalog): Promise<HTMLImageElement | null> {
  return loadInventoryImage(
    "material-images",
    catalog.materials.find((m) => m.id === materialId)?.image_path ?? null
  );
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws a titled box, wrapping raw (unwrapped) lines to fit. Returns the next y. */
function drawBoxedSection(
  ctx: CanvasRenderingContext2D,
  title: string,
  rawLines: string[],
  y: number,
  bg = "#f9fafb"
): number {
  const padding = 14;
  const lineHeight = 20;
  const font = "14px sans-serif";
  const titleFont = "700 15px sans-serif";
  const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const innerMaxWidth = maxWidth - padding * 2;

  ctx.font = font;
  const wrapped: string[] = [];
  for (const raw of rawLines) wrapped.push(...wrapText(ctx, raw, innerMaxWidth));

  const titleHeight = title ? 24 : 0;
  const boxHeight = padding * 2 + titleHeight + Math.max(wrapped.length, 1) * lineHeight;

  ctx.fillStyle = bg;
  roundRect(ctx, PAGE_MARGIN, y, maxWidth, boxHeight, 8);
  ctx.fill();

  let innerY = y + padding;
  if (title) {
    ctx.font = titleFont;
    ctx.fillStyle = "#111827";
    ctx.fillText(title, PAGE_MARGIN + padding, innerY);
    innerY += titleHeight;
  }
  ctx.font = font;
  ctx.fillStyle = "#374151";
  for (const line of wrapped) {
    ctx.fillText(line, PAGE_MARGIN + padding, innerY);
    innerY += lineHeight;
  }

  return y + boxHeight + 18;
}

/** Draws wrapping pill chips, each with the tool's actual photo (or its icon as a fallback). Returns the next y. */
async function drawToolChips(
  ctx: CanvasRenderingContext2D,
  toolNames: string[],
  catalog: CanvasCatalog,
  x: number,
  y: number,
  maxWidth: number
): Promise<number> {
  const paddingX = 10;
  const iconSize = 18;
  const iconGap = 6;
  const chipHeight = 26;
  const gap = 8;
  ctx.font = "13px sans-serif";
  ctx.textBaseline = "middle";
  let cx = x;
  let cy = y;
  for (const name of toolNames) {
    const image = await toolImageFor(name, catalog);
    const textWidth = ctx.measureText(name).width;
    const chipWidth = textWidth + paddingX * 2 + iconSize + iconGap;
    if (cx + chipWidth > x + maxWidth && cx > x) {
      cx = x;
      cy += chipHeight + gap;
    }
    ctx.fillStyle = "#eef2f7";
    roundRect(ctx, cx, cy, chipWidth, chipHeight, chipHeight / 2);
    ctx.fill();
    const iconY = cy + (chipHeight - iconSize) / 2;
    if (image) {
      ctx.save();
      roundRect(ctx, cx + paddingX, iconY, iconSize, iconSize, 4);
      ctx.clip();
      ctx.drawImage(image, cx + paddingX, iconY, iconSize, iconSize);
      ctx.restore();
    } else {
      ctx.font = "14px sans-serif";
      ctx.fillText(toolIconFor(name, catalog), cx + paddingX, cy + chipHeight / 2 + 1);
      ctx.font = "13px sans-serif";
    }
    ctx.fillStyle = "#111827";
    ctx.fillText(name, cx + paddingX + iconSize + iconGap, cy + chipHeight / 2 + 1);
    cx += chipWidth + gap;
  }
  ctx.textBaseline = "top";
  return cy + chipHeight + 18;
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

function displayFieldValue(values: Record<string, string>, field: ServiceFieldDef): string {
  if (field.checklistItem) {
    const qty = values[`${field.key}__qty`];
    return qty ? `${field.checklistItem.question} — Qty: ${qty}` : field.checklistItem.question;
  }
  const value = values[field.key];
  if (value === "Other") {
    const explanation = values[`${field.key}__other`];
    return explanation ? `Other — ${explanation}` : "Other";
  }
  return value;
}

function zoneMeasurements(zone: WorkZone): { areaSqFt: number; perimeterFt: number } | null {
  if (zone.areaSqFt == null && zone.perimeterFt == null) return null;
  return { areaSqFt: zone.areaSqFt ?? 0, perimeterFt: zone.perimeterFt ?? 0 };
}

function formatMeasurements(m: { areaSqFt: number; perimeterFt: number }): string {
  return `${Math.round(m.areaSqFt).toLocaleString()} sq ft · ${Math.round(m.perimeterFt).toLocaleString()} ft perimeter`;
}

function toolIconFor(name: string, catalog: CanvasCatalog): string {
  return catalog.tools.find((t) => t.name === name)?.icon ?? "🧰";
}

function allToolsAcrossZones(zones: WorkZone[]): string[] {
  const set = new Set<string>();
  for (const zone of zones) {
    for (const tool of zone.service?.tools ?? []) set.add(tool);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

interface MaterialLineItem {
  zoneName: string;
  materialId: string;
  material: string;
  unit: string;
  quantity: number;
  totalCost: number | null;
  /** Manually added for this zone rather than computed from a sq-ft rule — no reliable quantity to show. */
  manual?: boolean;
}

function zoneMaterialLineItems(zone: WorkZone, areaSqFt: number, catalog: CanvasCatalog): MaterialLineItem[] {
  const service = zone.service;
  if (!service) return [];
  const items: MaterialLineItem[] = [];
  for (const rule of catalog.serviceMaterialRules) {
    if (rule.service_type_id !== service.typeId) continue;
    if (rule.match_field && service.values[rule.match_field] !== rule.match_value) continue;
    const material = catalog.materials.find((m) => m.id === rule.material_id);
    if (!material || !material.coverage_per_unit_sqft) continue;
    const rawUnits = areaSqFt / material.coverage_per_unit_sqft;
    const quantity = rawUnits * (1 + material.waste_factor_pct / 100);
    const totalCost = material.cost_per_unit != null ? quantity * material.cost_per_unit : null;
    items.push({
      zoneName: zone.name,
      materialId: material.id,
      material: material.name,
      unit: material.unit,
      quantity,
      totalCost,
    });
  }
  const ruleMaterialNames = new Set(items.map((item) => item.material));
  for (const name of service.materials ?? []) {
    if (ruleMaterialNames.has(name)) continue;
    const material = catalog.materials.find((m) => m.name === name);
    if (!material) continue;
    items.push({
      zoneName: zone.name,
      materialId: material.id,
      material: material.name,
      unit: material.unit,
      quantity: 1,
      totalCost: material.cost_per_unit,
      manual: true,
    });
  }
  return items;
}

function formatMaterialQuantity(item: MaterialLineItem): string {
  if (item.manual) {
    return item.totalCost != null ? `As needed · $${item.totalCost.toFixed(2)}` : "As needed";
  }
  const qty = item.quantity < 10 ? item.quantity.toFixed(1) : Math.round(item.quantity).toLocaleString();
  let text = `${qty} ${item.unit}`;
  if (item.unit === "cubic yards") {
    const loads = Math.ceil((item.quantity * CUBIC_FEET_PER_YARD) / WHEELBARROW_CUBIC_FEET);
    text += ` (≈${loads} wheelbarrow loads)`;
  }
  if (item.totalCost != null) text += ` · $${item.totalCost.toFixed(2)}`;
  return text;
}

async function renderCoverPage(
  planCanvas: HTMLCanvasElement,
  address: string,
  tools: string[],
  catalog: CanvasCatalog
): Promise<HTMLCanvasElement> {
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
    const iconSize = 18;
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const col = Math.floor(i / rowsPerColumn);
      const row = i % rowsPerColumn;
      const colX = PAGE_MARGIN + col * colWidth;
      const rowY = y + row * rowHeight;
      const image = await toolImageFor(tool, catalog);
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#374151";
      ctx.fillText("☐", colX, rowY);
      const iconX = colX + 22;
      if (image) {
        ctx.drawImage(image, iconX, rowY - 1, iconSize, iconSize);
      } else {
        ctx.fillText(toolIconFor(tool, catalog), iconX, rowY);
      }
      ctx.fillText(tool, iconX + iconSize + 6, rowY);
    }
  }

  return canvas;
}

async function renderZonePage(zone: WorkZone, catalog: CanvasCatalog): Promise<HTMLCanvasElement> {
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

  const HEADER_HEIGHT = 96;
  ctx.fillStyle = zone.color;
  ctx.fillRect(0, 0, PAGE_WIDTH, HEADER_HEIGHT);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 32px sans-serif";
  ctx.fillText(zone.name, PAGE_MARGIN, 26);
  if (zone.location.trim()) {
    ctx.font = "16px sans-serif";
    ctx.fillText(`📍 ${zone.location.trim()}`, PAGE_MARGIN, 66);
  }

  let y = HEADER_HEIGHT + 28;
  const service = zone.service;
  const serviceType = service ? serviceTypeById(service.typeId) : undefined;

  if (service && serviceType) {
    ctx.font = "700 22px sans-serif";
    ctx.fillStyle = "#111827";
    ctx.fillText(serviceType.label, PAGE_MARGIN, y);
    y += 36;

    const fieldLines = serviceType.fields
      .filter((field) => service.values[field.key])
      .map((field) =>
        field.checklistItem ? displayFieldValue(service.values, field) : `${field.label}: ${displayFieldValue(service.values, field)}`
      );
    if (fieldLines.length > 0) {
      y = drawBoxedSection(ctx, "Details", fieldLines, y);
    }

    if (service.tools.length > 0) {
      ctx.font = "700 15px sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText("Tools", PAGE_MARGIN, y);
      y += 24;
      y = await drawToolChips(ctx, service.tools, catalog, PAGE_MARGIN, y, maxWidth);
    }

    if (serviceType.autoScope) {
      const steps = splitScopeIntoSteps(serviceType.autoScope(service.values)).map((s) => `☐ ${s}`);
      y = drawBoxedSection(ctx, "Checklist", steps, y, "#eff6ff");
    }

    if (service.notes.trim()) {
      y = drawBoxedSection(ctx, "Notes", [service.notes.trim()], y, "#fffbeb");
    }

    if (service.photos.length > 0) {
      const photoSize = 200;
      const gap = 16;
      const maxPhotos = Math.min(service.photos.length, 3);
      let x = PAGE_MARGIN;
      for (let i = 0; i < maxPhotos; i++) {
        const photoElement = await loadInventoryImage("canvas-images", service.photos[i]);
        if (photoElement) {
          ctx.drawImage(photoElement, x, y, photoSize, photoSize);
          ctx.strokeStyle = "#e5e7eb";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, photoSize, photoSize);
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

async function renderMaterialsPage(
  zones: WorkZone[],
  address: string,
  catalog: CanvasCatalog
): Promise<HTMLCanvasElement> {
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
    const measurements = zoneMeasurements(zone);
    if (!measurements) continue;
    allItems.push(...zoneMaterialLineItems(zone, measurements.areaSqFt, catalog));
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
      "No bulk materials calculated yet — needs a zone with a manually entered area (sq ft) and a material rule configured.",
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

      const image = await materialImageFor(item.materialId, catalog);
      const iconSize = 20;
      const textX = PAGE_MARGIN + (image ? iconSize + 8 : 0);
      ctx.font = "14px sans-serif";
      const lines = wrapText(
        ctx,
        `☐ ${item.material}: ${formatMaterialQuantity(item)}`,
        maxWidth - (textX - PAGE_MARGIN)
      );
      if (image) ctx.drawImage(image, PAGE_MARGIN, y, iconSize, iconSize);
      ctx.fillStyle = "#374151";
      for (const [i, line] of lines.entries()) {
        ctx.fillText(line, textX, y + i * 20);
      }
      y += Math.max(lines.length * 20, image ? iconSize + 4 : 0);
      y += 6;
    }
  }

  y += 14;
  ctx.font = "700 19px sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Equipment to Rent", PAGE_MARGIN, y);
  y += 28;

  const rentals = Array.from(
    new Set(
      zones
        .flatMap((zone) => zone.service?.tools ?? [])
        .filter((toolName) => catalog.tools.find((t) => t.name === toolName)?.is_rental)
    )
  );
  if (rentals.length === 0) {
    ctx.font = "italic 14px sans-serif";
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("No rental equipment flagged for this job.", PAGE_MARGIN, y);
  } else {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#374151";
    const iconSize = 18;
    for (const tool of rentals) {
      const image = await toolImageFor(tool, catalog);
      if (image) {
        ctx.drawImage(image, PAGE_MARGIN, y - 2, iconSize, iconSize);
        ctx.fillText(`☐ ${tool}`, PAGE_MARGIN + iconSize + 6, y);
      } else {
        ctx.fillText(`☐ ${toolIconFor(tool, catalog)} ${tool}`, PAGE_MARGIN, y);
      }
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
function computeJobTotals(
  zones: WorkZone[],
  catalog: CanvasCatalog
): { totalCost: number; totalHours: number; hasNonFlatRate: boolean } {
  let totalCost = 0;
  let totalHours = 0;
  let hasNonFlatRate = false;
  for (const zone of zones) {
    const service = zone.service;
    if (!service) continue;
    const pricing = catalog.servicePricing.find((p) => p.service_type_id === service.typeId);
    if (!pricing) continue;
    if (pricing.cost != null) {
      totalCost += pricing.cost;
      if (pricing.cost_unit.trim().toLowerCase() !== "flat rate") hasNonFlatRate = true;
    }
    if (pricing.estimated_hours != null) totalHours += pricing.estimated_hours;
  }
  return { totalCost, totalHours, hasNonFlatRate };
}

function renderJobPlanPages(
  zones: WorkZone[],
  address: string,
  catalog: CanvasCatalog
): HTMLCanvasElement[] {
  const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) return [];

  const totalAreaSqFt = zones.reduce((sum, zone) => sum + (zoneMeasurements(zone)?.areaSqFt ?? 0), 0);
  const summary = `${zones.length} zone${zones.length === 1 ? "" : "s"}${
    totalAreaSqFt > 0 ? ` · ${Math.round(totalAreaSqFt).toLocaleString()} sq ft total` : ""
  }`;

  const totals = computeJobTotals(zones, catalog);
  const totalsParts: string[] = [];
  if (totals.totalCost > 0) {
    totalsParts.push(`Est. cost: $${totals.totalCost.toFixed(2)}${totals.hasNonFlatRate ? " (includes per-unit rates — verify)" : ""}`);
  }
  if (totals.totalHours > 0) totalsParts.push(`Est. time: ${totals.totalHours} hrs`);

  const headerLines: JobPlanLine[] = [
    { text: "Job Plan", font: "700 28px sans-serif", color: "#111827", indent: 0 },
    ...(address.trim() ? [{ text: address.trim(), font: "16px sans-serif", color: "#6b7280", indent: 0 }] : []),
    { text: summary, font: "15px sans-serif", color: "#374151", indent: 0 },
    ...(totalsParts.length > 0
      ? [{ text: totalsParts.join(" · "), font: "700 15px sans-serif", color: "#111827", indent: 0 }]
      : []),
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

function ZonePhotoThumbnail({ path }: { path: string }) {
  const supabase = createClient();
  const url = supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />;
}

interface ImageCanvasBoardProps {
  catalog: CanvasCatalog;
  /** When present, the design is saved to/loaded from the database (scoped to this job) instead of this browser's IndexedDB. */
  jobId?: string;
  initialDesign?: CanvasDesignRow | null;
  initialAddress?: string;
  /** Coordinates of the address confirmed when the property was created — used to
   * auto-load the same satellite photo here instead of making the user search again. */
  initialLat?: number;
  initialLng?: number;
  initialEvaluationStatus?: EvaluationStatus;
}

export function ImageCanvasBoard({
  catalog,
  jobId,
  initialDesign,
  initialAddress,
  initialLat,
  initialLng,
  initialEvaluationStatus,
}: ImageCanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const loadedRef = useRef(false);
  const uploadedImagePathRef = useRef<string | null>(null);
  const imageDirtyRef = useRef(false);

  const [image, setImage] = useState<CanvasImage | null>(null);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [address, setAddress] = useState("");
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [propertyLine, setPropertyLine] = useState<Point[]>([]);
  const [houseOutline, setHouseOutline] = useState<Point[]>([]);
  const [houseNeedsConfirmation, setHouseNeedsConfirmation] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [serviceDialogZoneId, setServiceDialogZoneId] = useState<string | null>(null);
  const [showSatelliteSearch, setShowSatelliteSearch] = useState(false);
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [submittingEval, setSubmittingEval] = useState(false);
  const [evalSubmitted, setEvalSubmitted] = useState(initialEvaluationStatus === "completed");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sideToolbarOpen, setSideToolbarOpen] = useState(true);

  // Lock background scroll while fullscreen, and let Escape back out of it.
  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleEscape(e: KeyboardEvent) {
      // If a zone/property line is mid-draw, the other Escape handler cancels
      // that first — don't also drop out of fullscreen in the same keypress.
      if (e.key === "Escape" && drawingPoints.length === 0) setIsFullscreen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFullscreen, drawingPoints.length]);

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

    if (houseOutline.length > 0) {
      const point = houseOutline[0];
      const r = 11;
      const headCx = point.x;
      const headCy = point.y - r * 1.8;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(headCx, headCy, r, Math.PI * 1.1, Math.PI * 1.9, false);
      ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(headCx, headCy, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }

    if (propertyLine.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(propertyLine[0].x, propertyLine[0].y);
      for (const point of propertyLine.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
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

    if ((tool === "zone" || tool === "property-line") && drawingPoints.length > 0) {
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
  }, [image, zones, propertyLine, houseOutline, tool, drawingPoints, cursorPos]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Job-scoped canvases are loaded from the database (passed in as a prop from
  // the server), not this browser's IndexedDB.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        uploadedImagePathRef.current = initialDesign?.image_path ?? null;
        if (initialDesign) {
          setLocked(initialDesign.locked);
          // Prefer the live property address over whatever was saved with this
          // design snapshot — the property address can be corrected later
          // (e.g. from a bad webhook value) and the canvas/PDF should follow it.
          setAddress(initialAddress || initialDesign.address || "");
          setZones(initialDesign.zones as unknown as WorkZone[]);
          setPropertyLine(initialDesign.property_line ?? []);
          setHouseOutline(initialDesign.house_outline ?? []);
          if (initialDesign.image_path) {
            const supabase = createClient();
            const url = supabase.storage.from("canvas-images").getPublicUrl(initialDesign.image_path).data
              .publicUrl;
            const res = await fetch(url);
            const blob = await res.blob();
            const element = await loadImageElement(blob);
            if (!cancelled) {
              setImage({
                element,
                blob,
                x: initialDesign.image_x,
                y: initialDesign.image_y,
                scale: initialDesign.image_scale,
                rotation: initialDesign.image_rotation,
                realWidthFeet: initialDesign.image_real_width_feet,
              });
            }
          }
        } else {
          setAddress(initialAddress ?? "");
          // No canvas design saved yet for this job — this is a freshly created
          // property, so load the same satellite photo the user already confirmed
          // when creating it instead of making them search for the address again.
          // Mark as loaded first so the state changes this triggers are picked up
          // by the debounced database autosave below, instead of being ignored.
          if (initialLat != null && initialLng != null) {
            loadedRef.current = true;
            await handleSelectSatelliteLocation({
              id: "confirmed-property",
              fullAddress: initialAddress ?? "",
              lat: initialLat,
              lng: initialLng,
            });
          }
        }
      } catch {
        // No saved design yet (or it failed to load) — start from a blank canvas.
      } finally {
        loadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once for the job this board was mounted for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Restore a previously autosaved design from this browser once on mount.
  // Only for the standalone /canvas page — job-scoped canvases use the effect above.
  useEffect(() => {
    if (jobId) return;
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
            setPropertyLine(design.propertyLine ?? []);
            setHouseOutline(design.houseOutline ?? []);
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
  }, [jobId]);

  // Debounced autosave to this browser's storage whenever the design changes.
  // Only for the standalone /canvas page — job-scoped canvases autosave to the
  // database instead (see the effect below).
  useEffect(() => {
    if (jobId) return;
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
        propertyLine,
        houseOutline,
      })
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [jobId, image, locked, address, zones, propertyLine, houseOutline]);

  // Debounced autosave to the database for job-scoped canvases. Zone photos
  // are uploaded to storage as soon as they're picked (see ZoneServiceDialog)
  // and only their storage paths live in zone state, so they're small enough
  // to persist here along with everything else.
  useEffect(() => {
    if (!jobId || !loadedRef.current) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          let imagePath = uploadedImagePathRef.current;
          if (imageDirtyRef.current && image?.blob) {
            const supabase = createClient();
            const path = `${jobId}/background-${uuid()}.jpg`;
            const { error } = await supabase.storage
              .from("canvas-images")
              .upload(path, image.blob, { upsert: true });
            if (!error) {
              imagePath = path;
              uploadedImagePathRef.current = path;
              imageDirtyRef.current = false;
            }
          }
          await saveCanvasDesign(jobId, {
            address,
            imagePath,
            imageX: image?.x ?? CANVAS_WIDTH / 2,
            imageY: image?.y ?? CANVAS_HEIGHT / 2,
            imageScale: image?.scale ?? 1,
            imageRotation: image?.rotation ?? 0,
            imageRealWidthFeet: image?.realWidthFeet ?? null,
            locked,
            propertyLine,
            houseOutline,
            zones,
          });
          setLastSavedAt(Date.now());
        } catch {
          // Best-effort autosave; the design is still held in memory this session.
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [jobId, image, locked, address, zones, propertyLine, houseOutline]);

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
        areaSqFt: null,
        perimeterFt: null,
      },
    ]);
    setDrawingPoints([]);
    setCursorPos(null);
    setServiceDialogZoneId(id);
  }

  function finalizePropertyLine() {
    if (drawingPoints.length < 3) return;
    setPropertyLine(drawingPoints);
    setDrawingPoints([]);
    setCursorPos(null);
    setTool("move");
  }

  /** A single click drops a pin — the house doesn't need a traced outline, just its location. */
  function placeHouseMarker(point: Point) {
    setHouseOutline([point]);
    setHouseNeedsConfirmation(false);
    setTool("move");
  }

  function handleHouseNotCorrect() {
    setHouseOutline([]);
    setHouseNeedsConfirmation(false);
    setTool("house");
  }

  useEffect(() => {
    if (tool !== "zone" && tool !== "property-line") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawingPoints([]);
        setCursorPos(null);
      } else if (e.key === "Enter") {
        if (tool === "zone") finalizeZone();
        else finalizePropertyLine();
      } else if (e.key === "Backspace") {
        setDrawingPoints((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // finalizeZone/finalizePropertyLine read drawingPoints/zones directly, so this
    // effect must re-bind whenever they change to avoid acting on a stale closure.
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
    imageDirtyRef.current = true;
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
    // edge. Fetch extra vertical padding, split evenly so the requested lat/lng stays
    // vertically centered in the final crop (cropping only from the bottom would push
    // the property off-center), and trim it back off after loading.
    const zoom = 18.7;
    const padding = 220;
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
    const cropTop = (padding * pixelRatio) / 2;
    cropCtx.drawImage(
      rawImage,
      0,
      cropTop,
      cropCanvas.width,
      cropCanvas.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    // Web Mercator ground resolution at this zoom/latitude, applied to the
    // requested (unscaled) width, gives the real-world span of the image —
    // shown as an informational "≈X ft across" badge only. Zone area/perimeter
    // are entered manually (see ZoneServiceDialog) since pixel-derived
    // measurements weren't reliable enough to trust.
    // Reference: standard XYZ/slippy-map tile scheme, 256px tiles doubling per
    // zoom level (same convention Mapbox, Google Maps, and OSM all use).
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
      // The satellite photo is centered on the geocoded address, which for a
      // residential lookup is almost always the house itself — pre-mark it
      // there and just ask the evaluator to confirm instead of making them
      // tap it manually every time.
      setHouseOutline([{ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }]);
      setHouseNeedsConfirmation(true);
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

  function handleSaveZoneService(
    location: string,
    service: ZoneServiceData | null,
    areaSqFt: number | null,
    perimeterFt: number | null
  ) {
    setZones((prev) =>
      prev.map((zone) =>
        zone.id === serviceDialogZoneId ? { ...zone, location, service, areaSqFt, perimeterFt } : zone
      )
    );
    setServiceDialogZoneId(null);
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const point = toCanvasPoint(e.clientX, e.clientY, canvas);

    if (tool === "house") {
      placeHouseMarker(point);
      return;
    }

    if (tool === "zone" || tool === "property-line") {
      if (drawingPoints.length >= 3 && distance(point, drawingPoints[0]) <= CLOSE_POINT_RADIUS) {
        if (tool === "zone") finalizeZone();
        else finalizePropertyLine();
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

    if (tool === "house") return;

    if (tool === "zone" || tool === "property-line") {
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
    uploadedImagePathRef.current = null;
    imageDirtyRef.current = true;
  }

  async function handleSubmitEvaluation() {
    if (!jobId) return;
    setSubmittingEval(true);
    try {
      await updateEvaluationStatus(jobId, "completed");
      setEvalSubmitted(true);
    } catch {
      // Best-effort — the evaluator can retry the button if this failed.
    } finally {
      setSubmittingEval(false);
    }
  }

  async function handleExportPdf() {
    const planCanvas = canvasRef.current;
    if (!planCanvas) return;

    setExporting(true);
    try {
      const tools = allToolsAcrossZones(zones);
      const coverCanvas = await renderCoverPage(planCanvas, address, tools, catalog);

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

      // Cover first, then the zone detail pages the crew flips through on-site,
      // and the office-facing materials/job-plan pages trail at the very end.
      addPageCanvas(coverCanvas);

      for (const zone of zones) {
        addPageCanvas(await renderZonePage(zone, catalog));
      }

      addPageCanvas(await renderMaterialsPage(zones, address, catalog));

      for (const jobPlanCanvas of renderJobPlanPages(zones, address, catalog)) {
        addPageCanvas(jobPlanCanvas);
      }

      const blob = pdf.output("blob");
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } finally {
      setExporting(false);
    }
  }

  function handleClosePdfPreview() {
    setPdfPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function handleDownloadPdf() {
    if (!pdfPreviewUrl) return;
    const link = document.createElement("a");
    link.href = pdfPreviewUrl;
    link.download = "scope-of-work.pdf";
    link.click();
  }

  async function handleClearSavedDesign() {
    if (!jobId) await clearDesign();
    setImage(null);
    setLocked(false);
    setAddress(initialAddress ?? "");
    setZones([]);
    setPropertyLine([]);
    setDrawingPoints([]);
    setCursorPos(null);
    setLastSavedAt(null);
    uploadedImagePathRef.current = null;
    imageDirtyRef.current = true;
  }

  const maxScale = image ? Math.max(1, Math.min(4, (CANVAS_WIDTH * 2) / image.element.width)) : 1;
  const dialogZone = zones.find((zone) => zone.id === serviceDialogZoneId) ?? null;

  // Guided, one-thing-at-a-time setup flow: image -> house -> property line,
  // each shown as the only prompt on screen. Once both are marked, the full
  // toolbar takes over — locking/rescaling/zones aren't single yes/no
  // questions, so that phase keeps the richer controls.
  const guidedStep: "image" | "house" | "property-line" | "editing" = !image
    ? "image"
    : houseOutline.length === 0
      ? "house"
      : propertyLine.length === 0
        ? "property-line"
        : "editing";
  const isDrawingNow = tool === "house" || tool === "property-line" || tool === "zone";

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

      {guidedStep === "image" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
          <p className="text-sm font-medium">What&apos;s the property address?</p>
          <SatelliteAddressSearch onSelect={handleSelectSatelliteLocation} disabled={satelliteLoading} />
          {satelliteLoading && <p className="text-xs text-muted-foreground">Loading satellite photo...</p>}
          {satelliteError && <p className="text-xs text-destructive">{satelliteError}</p>}
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} className="self-start">
            <ImageUp className="h-4 w-4" />
            Upload an image instead
          </Button>
        </div>
      )}

      {houseNeedsConfirmation && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Is this the correct house?</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleHouseNotCorrect}>
              No
            </Button>
            <Button type="button" size="sm" onClick={() => setHouseNeedsConfirmation(false)}>
              Yes
            </Button>
          </div>
        </div>
      )}

      {guidedStep === "house" && !isDrawingNow && !houseNeedsConfirmation && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Mark the house — tap once on the map to drop a pin on it.</span>
          <Button type="button" size="sm" onClick={() => selectTool("house")}>
            <Home className="h-4 w-4" />
            Mark House
          </Button>
        </div>
      )}

      {guidedStep === "property-line" && !isDrawingNow && !houseNeedsConfirmation && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Now draw the property line.</span>
          <Button type="button" size="sm" onClick={() => selectTool("property-line")}>
            <Route className="h-4 w-4" />
            Draw Property Line
          </Button>
        </div>
      )}

      {guidedStep === "editing" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/60 bg-card/70 p-2 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted p-1">
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
              variant={tool === "house" ? "default" : "ghost"}
              disabled={!image}
              onClick={() => selectTool("house")}
            >
              <Home className="h-4 w-4" />
              {houseOutline.length > 0 ? "Redraw House" : "Mark House"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "property-line" ? "default" : "ghost"}
              disabled={!image}
              onClick={() => selectTool("property-line")}
            >
              <Route className="h-4 w-4" />
              {propertyLine.length > 0 ? "Redraw Property Line" : "Draw Property Line"}
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Wrench className="h-3 w-3" aria-hidden />
              <Link
                href="/admin/tools"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-primary hover:underline"
              >
                Tools
              </Link>
              <span aria-hidden>·</span>
              <Link
                href="/admin/materials"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-primary hover:underline"
              >
                Material Database
              </Link>
              <span aria-hidden>·</span>
              <Link
                href="/admin/service-pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-primary hover:underline"
              >
                Services
              </Link>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={exporting} onClick={handleExportPdf}>
              <Download className="h-4 w-4" />
              {exporting ? "Building PDF..." : "Preview PDF"}
            </Button>
            {jobId && (
              <Button
                type="button"
                size="sm"
                disabled={submittingEval || evalSubmitted}
                onClick={handleSubmitEvaluation}
              >
                <CheckCircle2 className="h-4 w-4" />
                {evalSubmitted ? "Evaluation Submitted" : submittingEval ? "Submitting..." : "Submit Evaluation"}
              </Button>
            )}
            {lastSavedAt && (
              <span className="text-xs text-muted-foreground">
                {jobId ? "Saved to this job" : "Autosaved in this browser"}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "relative overflow-hidden border-border bg-muted",
          isFullscreen ? "fixed inset-0 z-50 border-0" : "rounded-lg border"
        )}
      >
        <div className={isFullscreen ? "h-full overflow-auto" : "max-h-[70vh] overflow-auto"}>
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
        </div>

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
            Auto-scaled · ≈{Math.round(image.realWidthFeet).toLocaleString()} ft across
          </div>
        )}

        {image && (
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/85"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}

        {isFullscreen && guidedStep === "editing" && (
          <div className="absolute right-3 top-3 flex items-start gap-1">
            {sideToolbarOpen && (
              <div className="flex flex-col gap-1 rounded-xl bg-black/70 p-1.5 backdrop-blur-md">
                <Button
                  type="button"
                  size="sm"
                  variant={tool === "move" ? "secondary" : "ghost"}
                  className="justify-start text-white hover:text-white"
                  onClick={() => selectTool("move")}
                >
                  <MousePointer2 className="h-4 w-4" />
                  Move
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tool === "house" ? "secondary" : "ghost"}
                  className="justify-start text-white hover:text-white"
                  onClick={() => selectTool("house")}
                >
                  <Home className="h-4 w-4" />
                  {houseOutline.length > 0 ? "Redraw House" : "Mark House"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tool === "property-line" ? "secondary" : "ghost"}
                  className="justify-start text-white hover:text-white"
                  onClick={() => selectTool("property-line")}
                >
                  <Route className="h-4 w-4" />
                  {propertyLine.length > 0 ? "Redraw Line" : "Draw Line"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tool === "zone" ? "secondary" : "ghost"}
                  className="justify-start text-white hover:text-white"
                  onClick={() => selectTool("zone")}
                >
                  <PenTool className="h-4 w-4" />
                  Draw Zone
                </Button>
                {tool !== "house" && drawingPoints.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-start text-white hover:text-white"
                    onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
                  >
                    <Undo2 className="h-4 w-4" />
                    Undo Point
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-start text-white hover:text-white"
                  onClick={() => setLocked((prev) => !prev)}
                >
                  {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  {locked ? "Unlock" : "Lock"}
                </Button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSideToolbarOpen((v) => !v)}
              title={sideToolbarOpen ? "Collapse toolbar" : "Expand toolbar"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/85"
            >
              {sideToolbarOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>

      {isDrawingNow && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tool === "house"
              ? "Click once on the map to drop a pin on the house."
              : `Click to add points. Click the first point (or press Enter) to close the ${
                  tool === "property-line" ? "property line" : "zone"
                }. Backspace undoes a point, Escape cancels.`}
          </p>
          {tool !== "house" && drawingPoints.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
            >
              <Undo2 className="h-4 w-4" />
              Undo Point
            </Button>
          )}
        </div>
      )}

      {guidedStep === "editing" && !isDrawingNow && (
        <p className="text-xs text-muted-foreground">
          {locked
            ? "The background is locked in place. Unlock it to reposition, rescale, or replace it."
            : "Drag the image to reposition it, use the scale slider to resize, then lock it in place before drawing zones."}
        </p>
      )}

      {guidedStep === "editing" && image && !locked && tool === "move" && (
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

      {guidedStep === "editing" && (
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
      )}

      {guidedStep === "editing" && !showSatelliteSearch && (satelliteLoading || satelliteError) && (
        <p className={`text-xs ${satelliteError ? "text-destructive" : "text-muted-foreground"}`}>
          {satelliteError ?? "Loading the satellite photo you confirmed..."}
        </p>
      )}

      {guidedStep === "editing" && showSatelliteSearch && !locked && (
        <div className="flex flex-col gap-1 rounded-2xl border border-white/60 bg-card/70 p-3 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
          <SatelliteAddressSearch onSelect={handleSelectSatelliteLocation} disabled={satelliteLoading} />
          {satelliteLoading && <p className="text-xs text-muted-foreground">Loading satellite photo...</p>}
          {satelliteError && <p className="text-xs text-destructive">{satelliteError}</p>}
        </div>
      )}

      {guidedStep === "editing" && (
      <div className="rounded-2xl border border-white/60 bg-card/70 p-3 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
        <h2 className="text-sm font-semibold">Work Zones</h2>
        {zones.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No work zones yet. Select &ldquo;Draw Work Zone&rdquo; and click points on the canvas to outline one.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {zones.map((zone) => {
              const measurements = zoneMeasurements(zone);
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
                    {zone.service?.photos?.[0] && <ZonePhotoThumbnail path={zone.service.photos[0]} />}
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
      )}

      <ZoneServiceDialog
        key={serviceDialogZoneId ?? "none"}
        open={dialogZone !== null}
        zoneName={dialogZone?.name ?? ""}
        jobId={jobId}
        catalog={catalog}
        initialLocation={dialogZone?.location ?? ""}
        initialService={dialogZone?.service ?? null}
        initialAreaSqFt={dialogZone?.areaSqFt ?? null}
        initialPerimeterFt={dialogZone?.perimeterFt ?? null}
        onSave={handleSaveZoneService}
        onCancel={() => setServiceDialogZoneId(null)}
      />

      <Dialog open={pdfPreviewUrl !== null} onOpenChange={(next) => !next && handleClosePdfPreview()}>
        <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle>Preview scope of work PDF</DialogTitle>
            <DialogDescription>
              Review every page before downloading. Close this and adjust the job plan if
              anything looks off.
            </DialogDescription>
          </DialogHeader>

          {pdfPreviewUrl && (
            <iframe
              src={pdfPreviewUrl}
              title="Scope of work PDF preview"
              className="w-full flex-1 rounded-md border border-border"
            />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClosePdfPreview}>
              Close
            </Button>
            <Button type="button" onClick={handleDownloadPdf}>
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
