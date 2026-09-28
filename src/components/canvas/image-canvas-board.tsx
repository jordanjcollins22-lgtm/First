"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { v4 as uuid } from "uuid";
import Link from "next/link";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Home, ImageUp, Loader2, Lock, Maximize2, Minimize2, Minus, MousePointer2, PenTool, RefreshCw, RotateCcw, Route, Ruler, Satellite, StickyNote, Trash2, Undo2, Unlock, Wrench, X, ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { publicEnv } from "@/lib/public-env";
import { autoBearing, describeHeading, normalizeDegrees } from "@/lib/orientation";
import { coverScale, visibleWidthFeet, zoomAdjustmentFor } from "@/lib/canvas-cover";
import type { MeasurementKind } from "@/lib/zone-measurement";
import { canSubmit, submitLabel } from "@/lib/evaluation-resubmit";
import {
  canStepMapZoom,
  clampScale,
  distanceBetween,
  pinchScale,
  stepMapZoom,
  zoomBounds,
  zoomPercent,
} from "@/lib/canvas-zoom";
import { nearbyRoads } from "@/lib/mapbox-roads";
import { drawFrontTarget } from "@/lib/canvas-front-target";
import {
  addDrawingPoint,
  canClose,
  closeLabel,
  drawingHint,
  shouldClose,
} from "@/lib/zone-drawing";
import {
  addMark,
  markAt,
  removeMark,
  updateMark,
  withoutEmpty,
  type CanvasMark,
} from "@/lib/canvas-marks";
import { loadDesign, saveDesign, clearDesign } from "@/lib/canvas-storage";
import { createClient } from "@/lib/supabase/client";
import { isNoSignal, keepForLater, localPreview, removeIfPresent } from "@/lib/offline/outbox";
import { saveCanvasDesign } from "@/lib/actions/canvas-design-actions";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { SatelliteAddressSearch } from "./satellite-address-search";
import { compareImagery, describeImagery } from "@/lib/image-identity";
import { ZoneServiceDialog } from "./zone-service-dialog";
import { serviceTypeById } from "./service-catalog";
import type { Point, WorkZone, ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";
import { ExpectationsCard } from "@/components/canvas/expectations-card";
import { formatMeasurements, zoneMeasurements } from "@/lib/proposal-pricing";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas-dimensions";
import { centroidOf, groundRegions, groundToBoard, viewBearing, type ImageGeo, type LotData } from "@/lib/lot-map";
import { isSeededZone, type ZoneSeed } from "@/lib/evaluation-visit";
import { countyLotForJob } from "@/lib/actions/lot-actions";

const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 = 156543.03392;

/** Mapbox's limit on a static image's side, and what we ask for. Square, so
 * there is photo under the corners whichever way it is turned. */
const SATELLITE_REQUEST_SIZE = 1280;

/** The strip trimmed off for Mapbox's attribution, split top and bottom. */
const SATELLITE_PADDING = 220;

/** How close in the photo was before it had to be scaled up to cover the
 * corners. The fetch backs off from here by exactly that scaling, so the
 * board still shows about the same amount of ground it always did. */
const BASE_SATELLITE_ZOOM = 18.7;

interface CanvasImage {
  element: HTMLImageElement;
  blob: Blob;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Real-world feet spanned by the image's full native width, once known. */
  realWidthFeet: number | null;
  /**
   * True for a photo somebody uploaded rather than one fetched from the map.
   *
   * Decides the zoom floor. An upload opens showing all of itself and can be
   * scaled back down to that; a satellite image keeps the covering floor,
   * because it is fetched to fit the board and is meant to be turned.
   */
  uploaded: boolean;
}

type Tool = "move" | "zone" | "property-line" | "house" | "note";

function toCanvasPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (CANVAS_WIDTH / rect.width),
    y: (clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
  };
}

/** Where each part of the yard goes on the board when the county has no lot, as fractions across and down. */
const FALLBACK_SPOT: Record<string, [number, number]> = {
  front: [0.5, 0.78],
  back: [0.5, 0.22],
  sides: [0.16, 0.5],
  foundation: [0.5, 0.5],
  whole: [0.84, 0.5],
};

type BoardPlacement = { x: number; y: number; scale: number; rotation: number; elementWidth: number };

/**
 * Where a piece of work from the pre-eval sits on the board: over the part
 * of the yard it is in, when the county has the lot, shrunk a step for
 * each one before it in that part so they nest and each can be seen; with
 * no lot, a square near the middle, to be redrawn.
 */
function seedPoints(
  area: string,
  nth: number,
  slot: number,
  regions: ReturnType<typeof groundRegions> | null,
  imageGeo: ImageGeo | null,
  onBoard: BoardPlacement
): Point[] {
  const shrink = Math.max(0.4, 1 - nth * 0.15);
  const rings = regions?.[area as keyof typeof regions];
  if (rings && rings.length > 0 && imageGeo) {
    const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));
    const raw = ring.map((p) => groundToBoard(p, imageGeo, onBoard));
    const cx = raw.reduce((sum, p) => sum + p.x, 0) / raw.length;
    const cy = raw.reduce((sum, p) => sum + p.y, 0) / raw.length;
    return raw.map((p) => ({ x: cx + (p.x - cx) * shrink, y: cy + (p.y - cy) * shrink }));
  }
  // No lot to go by: each part of the yard in a spot of its own, the front
  // at the bottom of the board where the front is marked, so they don't
  // pile up in the middle.
  const half = 60 * shrink;
  const spot = FALLBACK_SPOT[area];
  const cx = spot ? CANVAS_WIDTH * spot[0] : CANVAS_WIDTH / 2 + (slot % 4) * 40 - 60;
  const cy = spot ? CANVAS_HEIGHT * spot[1] : CANVAS_HEIGHT / 2 + Math.floor(slot / 4) * 40 - 40;
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
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

function zoneServiceSummary(service: ZoneServiceData, catalog: CanvasCatalog): string {
  return (
    catalog.servicePricing.find((p) => p.service_type_id === service.typeId)?.name ??
    serviceTypeById(service.typeId)?.label ??
    "Details added"
  );
}

function ZonePhotoThumbnail({ path }: { path: string }) {
  const supabase = createClient();
  // A photo still on the phone, taken with no signal, shows from there until it uploads.
  const url = localPreview(path) ?? supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
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
  /** Who is doing the evaluation, so a note has somebody to ask about it. */
  evaluatorName?: string | null;
  /**
   * For trying the tool: nothing is saved anywhere, not even in this
   * browser, and it opens blank every time.
   */
  practice?: boolean;
  /**
   * Zones to start from, made from the evaluator's on-site set-up of the
   * client's pre-evaluation form. Kept in step with it: a piece of work
   * kept there is a zone here, drawn over the part of the yard it is in,
   * and one removed there is taken off. Zones drawn by hand are left alone.
   */
  seedZones?: ZoneSeed[];
  /** For practice: a lot to draw the areas on, since there is no job to look one up for. */
  demoLot?: LotData | null;
  /** Told when a zone made from the set-up is deleted on the map. */
  onSeedRemoved?: (id: string) => void;
  /**
   * The client's pre-eval, laid over the map as suggestions, separate from
   * the site map itself: each is shown dashed over the part of the yard it
   * is in, with a tick and a cross. They are not areas until ticked.
   */
  suggestions?: ZoneSeed[];
  /** Told when a suggestion is ticked (true) or crossed out (false). */
  onSuggestion?: (id: string, accept: boolean) => void;
  /**
   * For the evaluator's visit, where the submit is a big button of its own
   * under the map: the board's own Submit is hidden, and this is handed a
   * way to save the map now and submit it.
   */
  controlRef?: React.MutableRefObject<{ submit: () => Promise<boolean> } | null>;
}

export function ImageCanvasBoard({
  catalog,
  jobId,
  initialDesign,
  initialAddress,
  initialLat,
  initialLng,
  initialEvaluationStatus,
  evaluatorName,
  practice = false,
  seedZones,
  demoLot = null,
  onSeedRemoved,
  suggestions,
  onSuggestion,
  controlRef,
}: ImageCanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  /** Every finger currently on the board, in screen coordinates. */
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** Where a two-finger pinch began, so the zoom is measured from there and
   * cannot drift the way a frame-by-frame ratio does. */
  const pinchRef = useRef<{ startScale: number; startDistance: number; bounds: { min: number; max: number } } | null>(
    null
  );
  const loadedRef = useRef(false);
  const uploadedImagePathRef = useRef<string | null>(null);
  const imageDirtyRef = useRef(false);

  const [image, setImage] = useState<CanvasImage | null>(null);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [address, setAddress] = useState("");
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [propertyLine, setPropertyLine] = useState<Point[]>([]);
  const [marks, setMarks] = useState<CanvasMark[]>([]);
  const [editingMark, setEditingMark] = useState<CanvasMark | null>(null);
  const [houseOutline, setHouseOutline] = useState<Point[]>([]);
  const [houseNeedsConfirmation, setHouseNeedsConfirmation] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [serviceDialogZoneId, setServiceDialogZoneId] = useState<string | null>(null);
  const [showSatelliteSearch, setShowSatelliteSearch] = useState(false);
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  // Where the photo came from and which way it is turned. Kept so the
  // evaluator can nudge the turn and get a fresh, full-frame photo back
  // rather than a rotated one with white corners.
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  /** How far out the satellite photo was asked for. Stepping this fetches a
   * genuinely wider picture, which is the only way to see past its edge. */
  const [mapZoom, setMapZoom] = useState(BASE_SATELLITE_ZOOM);
  const [bearing, setBearing] = useState(0);
  // Where the satellite photo was taken from, so the county's property line
  // and the house can be drawn on the ground. Null for an uploaded photo.
  const [imageGeo, setImageGeo] = useState<ImageGeo | null>(null);
  const [countyLot, setCountyLot] = useState<LotData | null>(demoLot);
  /** Whether the county has answered, with a lot or without one. Practice has nobody to ask. */
  const [countyChecked, setCountyChecked] = useState(practice);
  const [orientConfirmed, setOrientConfirmed] = useState(true);
  const [keepCentered, setKeepCentered] = useState(true);
  const [autoTurned, setAutoTurned] = useState<number | null>(null);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  /** What the last imagery check found. Kept separate from the error line:
   * "no change" is a successful answer, not a failure. */
  const [imageryNote, setImageryNote] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [submittingEval, setSubmittingEval] = useState(false);
  const [evalSubmitted, setEvalSubmitted] = useState(initialEvaluationStatus === "completed");
  /** What the last submit did, shown back so a resubmit is checkable on the
   * spot rather than days later. */
  const [evalResult, setEvalResult] = useState<
    { tone: "ok" | "warn"; text: string; note?: string | null } | null
  >(null);
  /** Set when regenerating would clear a client's acceptance. */
  const [evalConfirm, setEvalConfirm] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sideToolbarOpen, setSideToolbarOpen] = useState(true);

  // The pre-eval's suggestions, placed where they would go as areas, once
  // the photo, the county and the way the house faces are all settled.
  const suggestionShapes = useMemo(() => {
    if (!suggestions || suggestions.length === 0 || !image || !countyChecked || !orientConfirmed) return [];
    const regions = countyLot && imageGeo ? groundRegions(countyLot) : null;
    const onBoard = { x: image.x, y: image.y, scale: image.scale, rotation: image.rotation, elementWidth: image.element.width };
    const inArea = new Map<string, number>();
    return suggestions.map((seed, i) => {
      const nth = inArea.get(seed.area) ?? 0;
      inArea.set(seed.area, nth + 1);
      const points = seedPoints(seed.area, nth, i, regions, imageGeo, onBoard);
      return {
        seed,
        points,
        cx: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        cy: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      };
    });
  }, [suggestions, image, countyChecked, orientConfirmed, countyLot, imageGeo]);
  // One column of ticks and crosses per part of the yard, in the middle of it.
  const suggestionGroups = useMemo(() => {
    const groups = new Map<string, { area: string; location: string; cx: number; cy: number; shapes: (typeof suggestionShapes[number] & { label: string })[] }>();
    for (const shape of suggestionShapes) {
      const group = groups.get(shape.seed.area) ?? { area: shape.seed.area, location: shape.seed.location, cx: shape.cx, cy: shape.cy, shapes: [] };
      const prefix = `${shape.seed.location} · `;
      group.shapes.push({ ...shape, label: shape.seed.name.startsWith(prefix) ? shape.seed.name.slice(prefix.length) : shape.seed.name });
      groups.set(shape.seed.area, group);
    }
    return [...groups.values()];
  }, [suggestionShapes]);
  const suggestionShapesRef = useRef(suggestionShapes);
  useEffect(() => {
    suggestionShapesRef.current = suggestionShapes;
  }, [suggestionShapes]);
  /** A suggestion just ticked, whose details open once it is an area. */
  const openWhenReadyRef = useRef<string | null>(null);

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

  // The target only makes sense while the question is open.
  const showFrontTarget = Boolean(image) && !orientConfirmed;
  // And so does holding the board still. Once the house is the right way
  // round, moving the background is ordinary work again.
  const holdCentered = keepCentered && !orientConfirmed;

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

      // The county's property line and the house, on the ground. Worked out
      // from the photo every time it is drawn, so they stay put however the
      // photo is moved, turned or zoomed.
      if (countyLot && imageGeo) {
        const onBoard = { x, y, scale, rotation, elementWidth: element.width };
        const trace = (ring: [number, number][]) => {
          ctx.beginPath();
          ring.forEach((p, i) => {
            const b = groundToBoard(p, imageGeo, onBoard);
            if (i === 0) ctx.moveTo(b.x, b.y);
            else ctx.lineTo(b.x, b.y);
          });
          ctx.closePath();
        };
        ctx.save();
        trace(countyLot.ring);
        ctx.setLineDash([10, 6]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#facc15";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 3;
        ctx.stroke();
        if (countyLot.footprint) {
          trace(countyLot.footprint);
          ctx.setLineDash([]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // While the house is being pointed the right way, a target at the bottom
    // of the board saying which way is "the front".
    if (showFrontTarget) drawFrontTarget(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Notes pinned to the picture. Numbered rather than captioned: the words
    // go in the list underneath, where they can be read without covering the
    // thing they are about.
    withoutEmpty(marks).forEach((mark, index) => {
      const radius = 15;
      ctx.save();
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#7c3aed";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 16px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), mark.x, mark.y + 1);
      ctx.restore();
    });

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

    // The pre-eval's suggestions: dashed and faint, under the real areas,
    // so it is plain they are not on the site map yet.
    for (const shape of suggestionShapes) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
      ctx.fill();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#f59e0b";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 2;
      ctx.stroke();
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
  }, [image, zones, propertyLine, houseOutline, marks, tool, drawingPoints, cursorPos, showFrontTarget, countyLot, imageGeo, suggestionShapes]);

  // A ticked suggestion opens its details as soon as it is an area, so the
  // evaluator goes straight on to what the client wants done there.
  useEffect(() => {
    const id = openWhenReadyRef.current;
    if (!id || !zones.some((zone) => zone.id === id)) return;
    openWhenReadyRef.current = null;
    const timer = setTimeout(() => setServiceDialogZoneId(id), 0);
    return () => clearTimeout(timer);
  }, [zones]);

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
          setBearing(initialDesign.image_bearing ?? 0);
          // Older designs have no flag. Anything with work already drawn on
          // it was oriented by hand under the old flow, so asking again would
          // put a step in front of finished work.
          setOrientConfirmed(
            initialDesign.orientation_confirmed ??
              (initialDesign.locked || (initialDesign.property_line?.length ?? 0) > 0)
          );
          // Prefer the live property address over whatever was saved with this
          // design snapshot — the property address can be corrected later
          // (e.g. from a bad webhook value) and the canvas should follow it.
          setAddress(initialAddress || initialDesign.address || "");
          setZones(initialDesign.zones as unknown as WorkZone[]);
          setPropertyLine(initialDesign.property_line ?? []);
          setHouseOutline(initialDesign.house_outline ?? []);
          setMarks(initialDesign.marks ?? []);
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
                // The permissive floor on the way back in, whatever the photo
                // started as. The scale it was saved at is the scale somebody
                // chose and locked, and a floor above it would move their work
                // for them.
                //
                // The floor and the clamp below have to agree, and for a long
                // time they did not: this said "permissive" while the clamp
                // asked for the covering floor. A map saved zoomed out past
                // that floor was therefore snapped back up to it on every
                // load, which is why a locked site map kept reopening zoomed
                // in and why re-locking it never helped. The saved numbers
                // were right; the reading of them was not.
                uploaded: true,
                x: initialDesign.image_x,
                y: initialDesign.image_y,
                // Clamped only against the same permissive floor, so this can
                // still catch a scale that is genuine nonsense without moving
                // one that is merely zoomed out.
                scale: clampScale(
                  initialDesign.image_scale,
                  zoomBounds({
                    imageWidth: element.width,
                    imageHeight: element.height,
                    canvasWidth: CANVAS_WIDTH,
                    canvasHeight: CANVAS_HEIGHT,
                    fitWhole: true,
                  })
                ),
                rotation: initialDesign.image_rotation,
                realWidthFeet: initialDesign.image_real_width_feet,
              });
              // Where the photo was taken. Maps saved before this was kept
              // were fetched at the property's pin at the standard zoom,
              // so that is the best answer for them.
              setImageGeo(
                (initialDesign.image_geo as ImageGeo | null | undefined) ??
                  (!initialDesign.image_uploaded && initialLat != null && initialLng != null
                    ? {
                        lng: initialLng,
                        lat: initialLat,
                        zoom: BASE_SATELLITE_ZOOM - zoomAdjustmentFor(coverScale(SATELLITE_REQUEST_SIZE, SATELLITE_REQUEST_SIZE - SATELLITE_PADDING, CANVAS_WIDTH, CANVAS_HEIGHT)),
                        bearing: initialDesign.image_bearing ?? 0,
                        request: SATELLITE_REQUEST_SIZE,
                        kept: SATELLITE_REQUEST_SIZE - SATELLITE_PADDING,
                      }
                    : null)
              );
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
            const lot = await countyLotForJob(jobId).catch(() => null);
            await handleSelectSatelliteLocation(
              {
                id: "confirmed-property",
                fullAddress: initialAddress ?? "",
                lat: initialLat,
                lng: initialLng,
              },
              lot
            );
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
    // Practice starts blank and stays in memory: nothing to restore. Given
    // a place, it opens on that place's photo, the way a job does.
    if (practice) {
      loadedRef.current = true;
      if (initialLat == null || initialLng == null) return;
      const timer = setTimeout(() => {
        void handleSelectSatelliteLocation({ id: "practice", fullAddress: initialAddress ?? "", lat: initialLat, lng: initialLng }, demoLot);
      }, 0);
      return () => clearTimeout(timer);
    }
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
                // As above: the permissive floor on the way back in, so the
                // slider cannot snap a saved zoom-out back up the first time
                // it is touched.
                uploaded: true,
                x: design.imageX,
                y: design.imageY,
                // The scale it was saved at, exactly. This one was saved by
                // this same code a moment ago, so there is nothing to correct.
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
            setMarks(design.marks ?? []);
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
    // Runs once, on mount: the place is where practice starts, not something to follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, practice]);

  // The county's property line and house for this job, drawn on the photo.
  // Fetched after the board is up; the board never waits on the county.
  useEffect(() => {
    if (!jobId || practice) return;
    let cancelled = false;
    countyLotForJob(jobId)
      .then((lot) => {
        if (!cancelled) setCountyLot(lot);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCountyChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, practice]);

  // Debounced autosave to this browser's storage whenever the design changes.
  // Only for the standalone /canvas page — job-scoped canvases autosave to the
  // database instead (see the effect below).
  useEffect(() => {
    if (jobId || practice) return;
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      saveDesign({
        imageBlob: image?.blob ?? null,
        imageX: image?.x ?? CANVAS_WIDTH / 2,
        imageY: image?.y ?? CANVAS_HEIGHT / 2,
        imageScale: image?.scale ?? 1,
        imageRotation: image?.rotation ?? 0,
        imageRealWidthFeet: image?.realWidthFeet ?? null,
        imageUploaded: image?.uploaded ?? false,
        locked,
        address,
        zones,
        propertyLine,
        houseOutline,
        marks: withoutEmpty(marks),
      })
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [jobId, practice, image, locked, address, zones, propertyLine, houseOutline, marks, bearing, orientConfirmed]);

  // Saving right now, rather than on the autosave's delay, and submitting:
  // for a submit button outside the board. Refreshed every render so it
  // always saves what is on the board this moment.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      submit: async () => {
        if (!jobId) return false;
        try {
          await saveCanvasDesign(jobId, {
            address,
            imagePath: uploadedImagePathRef.current,
            imageX: image?.x ?? CANVAS_WIDTH / 2,
            imageY: image?.y ?? CANVAS_HEIGHT / 2,
            imageScale: image?.scale ?? 1,
            imageRotation: image?.rotation ?? 0,
            imageRealWidthFeet: image?.realWidthFeet ?? null,
            imageBearing: bearing,
            imageGeo,
            orientationConfirmed: orientConfirmed,
            imageUploaded: image?.uploaded ?? false,
            locked,
            propertyLine,
            houseOutline,
            marks: withoutEmpty(marks),
            zones,
          });
        } catch {
          // The autosave has most of it; submitting still goes ahead.
        }
        return handleSubmitEvaluation();
      },
    };
  });

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
          const design = {
            address,
            imagePath,
            imageX: image?.x ?? CANVAS_WIDTH / 2,
            imageY: image?.y ?? CANVAS_HEIGHT / 2,
            imageScale: image?.scale ?? 1,
            imageRotation: image?.rotation ?? 0,
            imageRealWidthFeet: image?.realWidthFeet ?? null,
            imageBearing: bearing,
            imageGeo,
            orientationConfirmed: orientConfirmed,
            imageUploaded: image?.uploaded ?? false,
            locked,
            propertyLine,
            houseOutline,
            marks: withoutEmpty(marks),
            zones,
          };
          try {
            await saveCanvasDesign(jobId, design);
            setLastSavedAt(Date.now());
            // Saved for real, so an older copy kept with no signal must not be sent over it.
            void removeIfPresent(`site-map:${jobId}`);
          } catch (error) {
            // No signal: the map as it is now is kept on the phone, one copy
            // per job, and saved by itself when there is signal.
            if (isNoSignal(error)) {
              await keepForLater({ id: `site-map:${jobId}`, kind: "site-map", scope: `site-map:${jobId}`, label: "The site map", blob: null, type: "", args: { jobId, design } });
            }
          }
        } catch {
          // Best-effort autosave; the design is still held in memory this session.
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [jobId, image, locked, address, zones, propertyLine, houseOutline, marks, bearing, orientConfirmed, imageGeo]);

  // The house and the property line from the county, on a satellite photo
  // that has none yet: nobody needs to tap the house or trace the lot when
  // the county already has both.
  useEffect(() => {
    if (!countyLot || !imageGeo || !image || propertyLine.length > 0) return;
    const onBoard = { x: image.x, y: image.y, scale: image.scale, rotation: image.rotation, elementWidth: image.element.width };
    const ring = countyLot.ring.slice(0, -1).map((p) => groundToBoard(p, imageGeo, onBoard));
    if (ring.length < 3) return;
    const house = countyLot.footprint ? groundToBoard(centroidOf(countyLot.footprint), imageGeo, onBoard) : null;
    const timer = setTimeout(() => {
      setPropertyLine(ring);
      if (house) setHouseOutline([house]);
      setHouseNeedsConfirmation(false);
      setOrientConfirmed(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [countyLot, imageGeo, image, propertyLine.length]);

  // The on-site set-up, as zones. Waits for the photo and the county, so a
  // part of the yard is drawn where it is on the ground; with no county lot
  // it is a square near the middle, to be redrawn.
  useEffect(() => {
    // And after the house is pointed the right way, since turning the photo
    // fetches a new one and the areas would be left where the old one was.
    if ((!jobId && !practice) || !seedZones || !image || !countyChecked || !orientConfirmed) return;
    const wanted = new Set(seedZones.map((seed) => seed.id));
    // A beat after the photo is drawn, so the zones land on it.
    const timer = setTimeout(() =>
      setZones((prev) => {
        const kept = prev.filter((zone) => !isSeededZone(zone.id) || wanted.has(zone.id));
        const have = new Set(kept.map((zone) => zone.id));
        const missing = seedZones.filter((seed) => !have.has(seed.id));
        if (missing.length === 0 && kept.length === prev.length) return prev;
        const regions = countyLot && imageGeo ? groundRegions(countyLot) : null;
        const onBoard = { x: image.x, y: image.y, scale: image.scale, rotation: image.rotation, elementWidth: image.element.width };
        const inArea = new Map<string, number>();
        const made = missing.map((seed, i): WorkZone => {
          // Several pieces of work in one part of the yard sit one inside the
          // other, so each can be seen and tapped. A ticked suggestion lands
          // exactly where it was shown.
          const shown = suggestionShapesRef.current.find((shape) => shape.seed.id === seed.id);
          const nth = inArea.get(seed.area) ?? kept.filter((zone) => zone.location === seed.location).length;
          inArea.set(seed.area, nth + 1);
          const points = shown ? shown.points : seedPoints(seed.area, nth, prev.length + i, regions, imageGeo, onBoard);
          return {
            id: seed.id,
            name: seed.name,
            color: ZONE_COLORS[(prev.length + i) % ZONE_COLORS.length],
            points,
            location: seed.location,
            service: seed.typeId ? { typeId: seed.typeId, values: seed.values, notes: "", photos: [], tools: [] } : null,
            lengthFt: null,
            widthFt: null,
            areaSqFt: null,
            perimeterFt: null,
          };
        });
        return [...kept, ...made];
      }),
      0
    );
    return () => clearTimeout(timer);
  }, [jobId, practice, seedZones, image, countyChecked, countyLot, imageGeo, orientConfirmed]);

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
        lengthFt: null,
        widthFt: null,
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

  async function loadImageBlob(
    blob: Blob,
    realWidthFeet: number | null = null,
    uploaded = false
  ) {
    const element = await loadImageElement(blob);

    // A satellite image is scaled to cover the board's diagonal, so there is
    // photo under every corner however far it is turned -- fitting is what
    // put the white triangles there.
    //
    // An upload opens showing all of itself instead. The board's diagonal is
    // longer than either of its sides, so covering an uploaded photo always
    // crops it, and because the covering scale was also the zoom floor an
    // upload arrived cropped with no way to zoom out to what had just been
    // chosen.
    const scale = uploaded
      ? zoomBounds({
          imageWidth: element.width,
          imageHeight: element.height,
          canvasWidth: CANVAS_WIDTH,
          canvasHeight: CANVAS_HEIGHT,
          fitWhole: true,
        }).min
      : coverScale(element.width, element.height, CANVAS_WIDTH, CANVAS_HEIGHT);

    setImage({
      element,
      blob,
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      scale,
      rotation: 0,
      realWidthFeet,
      uploaded,
    });
    setLocked(false);
    imageDirtyRef.current = true;
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setImageGeo(null);
      loadImageBlob(file, null, true);
    }
    e.target.value = "";
  }

  async function fetchSatelliteImageBlob(
    lng: number,
    lat: number,
    mapBearing = 0,
    baseZoom = BASE_SATELLITE_ZOOM,
    /** Skip whatever the browser has stored. Checking for newer imagery
     * against a cached copy would answer "no change" every time, which is
     * the one answer the check must never invent. */
    fresh = false
  ): Promise<{ blob: Blob; realWidthFeet: number; geo: ImageGeo }> {
    // Mapbox requires its logo/attribution on static images, anchored to the
    // bottom edge. Fetch extra vertical padding, split evenly so the requested
    // lat/lng stays vertically centered in the final crop (cropping only from
    // the bottom would push the property off-center), and trim it back off
    // after loading.
    //
    // A square is requested rather than a board-shaped rectangle so there is
    // photo under the corners when it turns. 1280 a side is Mapbox's limit.
    const padding = SATELLITE_PADDING;
    const request = SATELLITE_REQUEST_SIZE;
    const keptHeight = request - padding;

    // Scaling up to fill the corners means seeing less ground, so the photo is
    // fetched from further out by exactly that much. The badge then reads
    // about the same as it always did.
    const zoom = baseZoom - zoomAdjustmentFor(
      coverScale(request, keptHeight, CANVAS_WIDTH, CANVAS_HEIGHT)
    );

    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},${mapBearing}/${request}x${request}@2x?access_token=${publicEnv.mapboxToken}`;
    const res = await fetch(url, fresh ? { cache: "reload" } : undefined);
    if (!res.ok) throw new Error("Couldn't load a satellite photo for that address.");
    const rawBlob = await res.blob();
    const rawImage = await loadImageElement(rawBlob);

    const pixelRatio = rawImage.width / request;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = request * pixelRatio;
    cropCanvas.height = keptHeight * pixelRatio;
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

    // Web Mercator ground resolution at this zoom/latitude. Reference: the
    // standard XYZ/slippy-map tile scheme, 256px tiles doubling per zoom level
    // (the convention Mapbox, Google Maps and OSM all share).
    //
    // The badge is about what is on the board, not about the whole photo —
    // those stopped being the same number when the photo grew past the board.
    // Zone area/perimeter are still entered by hand (see ZoneServiceDialog);
    // pixel-derived measurements were never reliable enough to trust.
    const metersPerPixel =
      (EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    const drawnWidth = request * coverScale(request, keptHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
    const realWidthFeet = visibleWidthFeet({
      canvasWidth: CANVAS_WIDTH,
      imageMapWidth: request,
      metresPerMapPixel: metersPerPixel,
      drawnWidth,
    });

    return new Promise((resolve, reject) => {
      cropCanvas.toBlob((blob) => {
        if (!blob) reject(new Error("Couldn't process the satellite photo."));
        else resolve({ blob, realWidthFeet, geo: { lng, lat, zoom, bearing: mapBearing, request, kept: keptHeight } });
      }, "image/png");
    });
  }

  async function handleSelectSatelliteLocation(suggestion: GeocodeSuggestion, lot: LotData | null = null) {
    setSatelliteError(null);
    setSatelliteLoading(true);
    try {
      const point = { lat: suggestion.lat, lng: suggestion.lng };

      // Turn the map before fetching rather than turning the photo after.
      // A photo requested at a bearing fills its frame; a photo rotated on
      // the canvas has white corners where the yard should be. With the
      // county's lot the street side is known, the same way the client's
      // pre-eval map is turned, so nobody is asked which way is the front.
      let turned = 0;
      if (lot) {
        turned = viewBearing(lot);
        setAutoTurned(turned);
      } else {
        try {
          const guess = autoBearing(point, await nearbyRoads(point));
          if (guess != null) turned = guess;
          setAutoTurned(guess);
        } catch {
          // No street data is not a failure — it just means the evaluator
          // turns it themselves, which is the next thing they are asked to do.
          setAutoTurned(null);
        }
      }

      const { blob, realWidthFeet, geo } = await fetchSatelliteImageBlob(
        suggestion.lng,
        suggestion.lat,
        turned,
        BASE_SATELLITE_ZOOM
      );
      await loadImageBlob(blob, realWidthFeet);
      setImageGeo(geo);
      setMapZoom(BASE_SATELLITE_ZOOM);
      setOrigin(point);
      setBearing(turned);
      setKeepCentered(true);
      setAddress(suggestion.fullAddress);
      setShowSatelliteSearch(false);
      if (lot) {
        // Front down, background locked. The house and the property line
        // are put on from the county once the photo is drawn (see below).
        setOrientConfirmed(true);
        setLocked(true);
        setHouseNeedsConfirmation(false);
      } else {
        setOrientConfirmed(false);
        // The satellite photo is centered on the geocoded address, which for a
        // residential lookup is almost always the house itself — pre-mark it
        // there and just ask the evaluator to confirm instead of making them
        // tap it manually every time.
        setHouseOutline([{ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }]);
        setHouseNeedsConfirmation(true);
      }
    } catch (err) {
      setSatelliteError(err instanceof Error ? err.message : "Couldn't load a satellite photo.");
    } finally {
      setSatelliteLoading(false);
    }
  }

  /**
   * Fetch the same spot from further out, or closer in.
   *
   * Scaling the photo cannot show what is not in it, so wanting to see the
   * neighbour's fence means a new photo. The bearing is kept, because a photo
   * requested at a bearing fills its frame and one rotated afterwards does
   * not — that is the whole reason the turn happens at the map.
   */
  async function refetchAtZoom(nextZoom: number) {
    if (!origin || satelliteLoading) return;
    setSatelliteError(null);
    setSatelliteLoading(true);
    try {
      // Any turn the evaluator made by hand is folded into the bearing we ask
      // the map for, rather than re-applied to the new photo afterwards. A
      // photo requested at a bearing fills its frame; one rotated on the
      // canvas has white where the garden should be. Without this, zooming
      // out quietly undoes the aiming they just did.
      const aimed = normalizeDegrees(bearing + (image?.rotation ?? 0));

      const { blob, realWidthFeet, geo } = await fetchSatelliteImageBlob(
        origin.lng,
        origin.lat,
        aimed,
        nextZoom
      );
      await loadImageBlob(blob, realWidthFeet);
      setImageGeo(geo);
      setBearing(aimed);
      setMapZoom(nextZoom);
      // Straight back to the middle: the new photo is centred on the same
      // point, and keeping a drag offset from the old one would put the house
      // somewhere it never was.
      recenterImage();
    } catch (err) {
      setSatelliteError(
        err instanceof Error ? err.message : "Couldn't load a wider satellite photo."
      );
    } finally {
      setSatelliteLoading(false);
    }
  }

  /**
   * Asks the map whether it has a different photo of this address.
   *
   * There is no capture date to be had — the static images API serves pixels
   * and says nothing about when they were taken — so this cannot report that
   * imagery is newer. What it can do is fetch the same view again, past the
   * browser cache, and say whether what came back differs from what is on the
   * board. That is a narrower claim and the wording matches it.
   *
   * A change is applied straight away rather than offered, because somebody
   * pressing this has asked for the current photo. The aiming and the zoom
   * are kept, so it is the same view with newer ground under it.
   */
  async function checkForNewerImagery() {
    if (!origin || satelliteLoading || !image) return;
    setSatelliteError(null);
    setImageryNote(null);
    setSatelliteLoading(true);

    try {
      const aimed = normalizeDegrees(bearing + image.rotation);
      const { blob, realWidthFeet, geo } = await fetchSatelliteImageBlob(
        origin.lng,
        origin.lat,
        aimed,
        mapZoom,
        true
      );

      const verdict = await compareImagery(image.blob, blob);
      setImageryNote(describeImagery(verdict));

      // Nothing is touched unless there is genuinely something new. Reloading
      // an identical photo would reset the aiming for no reason.
      if (verdict === "changed") {
        await loadImageBlob(blob, realWidthFeet);
        setImageGeo(geo);
        setBearing(aimed);
        recenterImage();
      }
    } catch (err) {
      setSatelliteError(
        err instanceof Error ? err.message : "Couldn't check for newer imagery."
      );
    } finally {
      setSatelliteLoading(false);
    }
  }

  /**
   * Turns the photo on the board.
   *
   * No re-fetch any more: the photo is fetched big enough to cover the board
   * at any angle, so turning it here is instant and shows nothing but photo.
   * That is what makes a slider possible — a control you drag cannot be
   * asking the network on every pixel.
   */
  function setRotation(degrees: number) {
    setImage((prev) => (prev ? { ...prev, rotation: degrees } : prev));
    imageDirtyRef.current = true;
  }

  /** Puts the photo back in the middle of the board. */
  function recenterImage() {
    setImage((prev) => (prev ? { ...prev, x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 } : prev));
    imageDirtyRef.current = true;
  }

  function selectTool(next: Tool) {
    setTool(next);
    setDrawingPoints([]);
    setCursorPos(null);
  }

  function handleDeleteZone(id: string) {
    setZones((prev) => prev.filter((zone) => zone.id !== id));
    // A zone from the client's form, taken off the map: said back to the
    // set-up so it is not put back.
    if (isSeededZone(id)) onSeedRemoved?.(id);
  }

  function handleSaveZoneService(
    location: string,
    service: ZoneServiceData | null,
    lengthFt: number | null,
    widthFt: number | null,
    areaSqFt: number | null,
    perimeterFt: number | null,
    measurementKind: MeasurementKind
  ) {
    setZones((prev) =>
      prev.map((zone) =>
        zone.id === serviceDialogZoneId
          ? { ...zone, location, service, lengthFt, widthFt, areaSqFt, perimeterFt, measurementKind }
          : zone
      )
    );
    setServiceDialogZoneId(null);
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const point = toCanvasPoint(e.clientX, e.clientY, canvas);

    // Track fingers regardless of tool: a pinch has to work while the zone
    // tool is selected too, or zooming in to draw accurately means switching
    // tools first and losing the half-drawn outline.
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && image && !locked) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        startScale: image.scale,
        startDistance: distanceBetween(a, b),
        bounds: boundsFor(image.element),
      };
      // A second finger cancels whatever the first one had started. Otherwise
      // the drag carries on underneath the pinch and the photo slides away.
      dragRef.current = null;
      setDrawingPoints([]);
      return;
    }

    if (tool === "house") {
      placeHouseMarker(point);
      return;
    }

    if (tool === "note") {
      // Tapping an existing pin opens it rather than stacking another on top
      // of it — two pins in one place is two notes nobody can tell apart.
      const existing = markAt(marks, point);
      if (existing) {
        setEditingMark(existing);
        return;
      }
      const id = uuid();
      const next = addMark(marks, point, "", evaluatorName ?? null, id);
      setMarks(next);
      setEditingMark(next[next.length - 1]);
      return;
    }

    if (tool === "zone" || tool === "property-line") {
      if (shouldClose(drawingPoints, point)) {
        if (tool === "zone") finalizeZone();
        else finalizePropertyLine();
      } else {
        // addDrawingPoint drops a tap that landed on the one just placed. A
        // finger on a phone held at arm's length reports two, and the second
        // used to become a corner sitting on top of the first.
        setDrawingPoints((prev) => addDrawingPoint(prev, point));
      }
      return;
    }

    // Held in the middle on purpose while orienting: the house is under the
    // centre of the frame, and a board that drifts is one where "point the
    // front at the bottom" stops meaning anything.
    if (locked || holdCentered || !image) return;
    dragRef.current = { startX: point.x, startY: point.y, originX: image.x, originY: image.y };
    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const point = toCanvasPoint(e.clientX, e.clientY, e.currentTarget);

    // A pinch beats everything else on the board. Two fingers down is never
    // an attempt to draw a zone, and treating the second one as a drag is how
    // the photo shoots across the screen while somebody is zooming.
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchRef.current && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()];
        setScale(
          pinchScale({
            startScale: pinchRef.current.startScale,
            startDistance: pinchRef.current.startDistance,
            distance: distanceBetween(a, b),
            bounds: pinchRef.current.bounds,
          })
        );
        return;
      }
    }

    if (tool === "house" || tool === "note") return;

    if (tool === "zone" || tool === "property-line") {
      if (drawingPoints.length > 0) setCursorPos(point);
      return;
    }

    if (locked || holdCentered || !dragRef.current || !image) return;
    setImage({
      ...image,
      x: dragRef.current.originX + (point.x - dragRef.current.startX),
      y: dragRef.current.originY + (point.y - dragRef.current.startY),
    });
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  }

  function handleScaleSliderChange(e: ChangeEvent<HTMLInputElement>) {
    setScale(Number(e.target.value));
  }

  /** The zoom range for a given photo on this board. */
  function boundsFor(element: HTMLImageElement) {
    return zoomBounds({
      imageWidth: element.width,
      imageHeight: element.height,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      fitWhole: image?.uploaded ?? false,
    });
  }

  /** Zoom the photo, never past the point where the corners go white. */
  function setScale(next: number) {
    if (locked || !image) return;
    setImage({ ...image, scale: clampScale(next, boundsFor(image.element)) });
    imageDirtyRef.current = true;
  }

  function handleRotationChange(e: ChangeEvent<HTMLInputElement>) {
    if (locked || !image) return;
    setImage({ ...image, rotation: Number(e.target.value) });
  }

  function handleRemoveImage() {
    setImage(null);
    setImageGeo(null);
    setLocked(false);
    uploadedImagePathRef.current = null;
    imageDirtyRef.current = true;
  }

  /**
   * Send the evaluation, and send it again after a correction.
   *
   * The proposal is a snapshot, so changing a zone's service does nothing to
   * the paperwork until a new one is taken. This is that button, and it stays
   * live after the first submit — it used to disable itself permanently, so a
   * proposal quoting the wrong service could never be put right.
   */
  async function handleSubmitEvaluation(force = false): Promise<boolean> {
    if (!jobId) return false;
    setSubmittingEval(true);
    setEvalResult(null);
    try {
      const outcome = await updateEvaluationStatus(jobId, "completed", { force });
      setEvalSubmitted(true);

      if (!outcome) {
        setEvalResult({ tone: "warn", text: "Submitted, but the proposal could not be rebuilt." });
      } else if (outcome.ok) {
        setEvalResult({
          tone: "ok",
          text: outcome.unchanged
            ? "Submitted. The proposal already matched, nothing changed."
            : `Proposal updated: ${outcome.changes.join(" · ")}`,
          note: outcome.note,
        });
      } else if (outcome.reason === "failed") {
        setEvalResult({ tone: "warn", text: `Submitted, but the proposal could not be rebuilt: ${outcome.message}` });
      } else if (outcome.reason === "needs_confirmation") {
        // Not an error. Regenerating clears a client's acceptance, so it asks
        // rather than doing it as a side effect of a button labelled Submit.
        setEvalConfirm(outcome.confirm ?? "Send a new proposal?");
        return false;
      } else {
        setEvalResult({
          tone: "warn",
          text:
            outcome.reason === "no_services"
              ? "Submitted, but no zone has a service on it yet, so there is no proposal to build."
              : "Submitted, but there is no site map to build a proposal from.",
        });
      }
      return true;
    } catch {
      setEvalResult({ tone: "warn", text: "Couldn't submit that. Try again." });
      return false;
    } finally {
      setSubmittingEval(false);
    }
  }

  async function handleClearSavedDesign() {
    if (!jobId && !practice) await clearDesign();
    setImage(null);
    setImageGeo(null);
    setLocked(false);
    setAddress(initialAddress ?? "");
    setZones([]);
    setPropertyLine([]);
    setMarks([]);
    setDrawingPoints([]);
    setCursorPos(null);
    setLastSavedAt(null);
    uploadedImagePathRef.current = null;
    imageDirtyRef.current = true;
  }

  // The floor is the scale that still covers the board at any angle. Dragging
  // below it is how the white corners come back, which is the one thing this
  // board is not allowed to show.
  const bounds = image
    ? zoomBounds({
        imageWidth: image.element.width,
        imageHeight: image.element.height,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
        fitWhole: image.uploaded,
      })
    : { min: 1, max: 1 };
  const dialogZone = zones.find((zone) => zone.id === serviceDialogZoneId) ?? null;

  // Guided, one-thing-at-a-time setup flow: image -> house -> property line,
  // each shown as the only prompt on screen. Once both are marked, the full
  // toolbar takes over — locking/rescaling/zones aren't single yes/no
  // questions, so that phase keeps the richer controls.
  const guidedStep: "image" | "orient" | "house" | "property-line" | "editing" = !image
    ? "image"
    : !orientConfirmed
      ? "orient"
      : houseOutline.length === 0
      ? "house"
      : propertyLine.length === 0
        ? "property-line"
        : "editing";
  const isDrawingNow = tool === "house" || tool === "property-line" || tool === "zone";
  const noteCount = withoutEmpty(marks).length;

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

      {houseNeedsConfirmation && guidedStep !== "orient" && (
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

      {guidedStep === "orient" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">Is the front of the house pointing down?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {autoTurned != null
                ? `Turned automatically, the street looked to be ${describeHeading(
                    normalizeDegrees(autoTurned + 180)
                  )} of the house. Check it against the arrow and nudge it if that is wrong.`
                : origin
                  ? "Couldn't find a street to go by, so this one is north-up. Turn it until the front faces the arrow."
                  : "Turn the photo until the front of the house faces the arrow at the bottom."}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Turn it</span>
              <span className="font-medium tabular-nums text-foreground">
                {Math.round(image?.rotation ?? 0)}°
              </span>
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={image?.rotation ?? 0}
              onChange={(e) => setRotation(Number(e.target.value))}
              aria-label="Turn the photo"
              className="h-8 w-full accent-primary"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Drag until the front faces the arrow</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setRotation(0)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Back to auto
              </Button>
            </div>
            {satelliteLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {image && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Zoom</span>
                <span className="font-medium tabular-nums text-foreground">
                  {zoomPercent(image.scale, bounds)}%
                </span>
              </div>
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={0.001}
                value={image.scale}
                onChange={handleScaleSliderChange}
                aria-label="Zoom the photo"
                className="h-8 w-full accent-primary"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Or pinch the photo. 100% is the whole picture.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setScale(bounds.min)}
                >
                  Fit
                </Button>
              </div>
            </div>
          )}

          {/* Zooming out stops at the whole photo, because there is no more
              photo — seeing further needs a wider one from the map. */}
          <MapZoomControls
            visible={origin != null}
            spanFeet={image?.realWidthFeet ?? null}
            mapZoom={mapZoom}
            busy={satelliteLoading}
            onStep={(steps) => refetchAtZoom(stepMapZoom(mapZoom, steps))}
          />

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={keepCentered}
              onChange={(e) => {
                setKeepCentered(e.target.checked);
                if (e.target.checked) recenterImage();
              }}
              className="h-4 w-4 rounded border-input"
            />
            <span>
              Keep the house in the middle
              {!keepCentered && ", off, so you can drag the photo"}
            </span>
          </label>

          {satelliteError && <p className="text-xs text-destructive">{satelliteError}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={satelliteLoading}
              onClick={() => {
                // Straight from "it is the right way up" to a locked
                // background: nothing between those two is a decision.
                recenterImage();
                setOrientConfirmed(true);
                setLocked(true);
                setKeepCentered(true);
              }}
            >
              <Lock className="h-4 w-4" />
              Front is down, lock it
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowSatelliteSearch(true)}>
              Different address
            </Button>
          </div>
        </div>
      )}

      {guidedStep === "house" && !isDrawingNow && !houseNeedsConfirmation && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Mark the house, tap once on the map to drop a pin on it.</span>
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
              variant={tool === "note" ? "default" : "ghost"}
              disabled={!image}
              onClick={() => selectTool("note")}
              title="Tap the picture to pin a note to a spot"
            >
              <StickyNote className="h-4 w-4" />
              Note{noteCount > 0 ? ` (${noteCount})` : ""}
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
            {countyLot && imageGeo && (
              <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" title="From Harford County's parcel map">
                <span className="inline-block h-0 w-5 border-t-[3px] border-dashed border-yellow-400" />
                County property line
              </span>
            )}
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
            {/* This used to build a scope-of-work PDF. The crew sheet replaced
                it: it is the same job read the same way, except it is live, so
                it cannot be a week out of date in somebody's downloads folder
                the way a printed copy always ended up being. */}
            {jobId && (
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href={`/jobs/${jobId}/work-order`} target="_blank" rel="noopener noreferrer">
                  <ClipboardList className="h-4 w-4" />
                  View crew sheet
                </Link>
              </Button>
            )}
            {jobId && !controlRef && (
              <Button
                type="button"
                size="sm"
                variant={evalSubmitted ? "outline" : "default"}
                disabled={!canSubmit(jobId, submittingEval)}
                onClick={() => handleSubmitEvaluation()}
              >
                {evalSubmitted ? <RefreshCw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {submitLabel(evalSubmitted ? "completed" : "scheduled", submittingEval)}
              </Button>
            )}
            {lastSavedAt && (
              <span className="text-xs text-muted-foreground">
                {jobId ? "Saved to this job" : "Autosaved in this browser"}
              </span>
            )}
          </div>

          {/* Built from the zones actually drawn, so it is about this lawn
              rather than about landscaping in general. Placed beside Submit
              because that is the last moment before the evaluator drives
              away, and everything on it is impossible to say afterwards. */}
          {jobId && <ExpectationsCard zones={zones} />}

          {evalConfirm && (
            <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{evalConfirm}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={submittingEval}
                  onClick={() => {
                    setEvalConfirm(null);
                    void handleSubmitEvaluation(true);
                  }}
                >
                  Send the new proposal
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEvalConfirm(null)}>
                  Leave it
                </Button>
              </div>
            </div>
          )}

          {evalResult && (
            <p
              className={`mt-2 text-xs ${
                evalResult.tone === "ok" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {evalResult.text}
              {evalResult.note && <span className="block">{evalResult.note}</span>}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          "relative overflow-hidden border-border bg-muted",
          isFullscreen ? "fixed inset-0 z-50 border-0" : "rounded-lg border"
        )}
      >
        <div className={isFullscreen ? "h-full overflow-auto" : "max-h-[70vh] overflow-auto"}>
          <div className="relative">
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
          {suggestionGroups.map((group) => (
            <div
              key={group.area}
              className={cn(
                "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5",
                tool !== "move" && "pointer-events-none opacity-40"
              )}
              style={{ left: `${(group.cx / CANVAS_WIDTH) * 100}%`, top: `${(group.cy / CANVAS_HEIGHT) * 100}%` }}
            >
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow">
                Asked for: {group.location}
              </span>
              {group.shapes.map((shape) => (
                <div key={shape.seed.id} className="flex items-center gap-1 rounded-full border border-amber-500 bg-white/95 py-0.5 pl-2.5 pr-0.5 shadow-md">
                  <span className="max-w-36 truncate text-xs font-semibold text-slate-900">{shape.label}</span>
                  <button
                    type="button"
                    aria-label={`Add ${shape.seed.name} to the site map`}
                    onClick={() => {
                      openWhenReadyRef.current = shape.seed.id;
                      onSuggestion?.(shape.seed.id, true);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Not doing ${shape.seed.name}`}
                    onClick={() => onSuggestion?.(shape.seed.id, false)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          </div>
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
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {tool === "house"
              ? "Click once on the map to drop a pin on the house."
              : drawingHint(tool === "property-line" ? "property-line" : "zone", drawingPoints.length)}
          </p>
          {tool !== "house" && drawingPoints.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
              {/* The move that always works. Closing used to depend on
                  landing a tap back on the first point, which outdoors on a
                  phone is how a shape ends up with a pile of stray corners. */}
              <Button
                type="button"
                size="sm"
                disabled={!canClose(drawingPoints)}
                onClick={() => {
                  if (tool === "zone") finalizeZone();
                  else finalizePropertyLine();
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                {closeLabel(tool === "property-line" ? "property-line" : "zone")}
              </Button>
            </div>
          )}
        </div>
      )}

      {tool === "note" && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Tap the picture where the note belongs. Tap a pin again to change it.
        </p>
      )}

      {/* The words go under the picture, not on it. A caption across a garden
          covers the thing it is about, and the number is enough to find. */}
      {noteCount > 0 && (
        <div className="rounded-2xl border border-white/60 bg-card/70 p-3 backdrop-blur-xl">
          <h3 className="mb-2 text-sm font-semibold">Notes on the picture</h3>
          <ol className="space-y-1">
            {withoutEmpty(marks).map((mark, index) => (
              <li key={mark.id} className="flex items-start gap-2 text-sm">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: "#7c3aed" }}
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => setEditingMark(mark)}
                >
                  <span className="block">{mark.note}</span>
                  {mark.authorName && (
                    <span className="block text-[11px] text-muted-foreground">
                      {mark.authorName}
                    </span>
                  )}
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() => setMarks((prev) => removeMark(prev, mark.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ol>
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
              min={bounds.min}
              max={bounds.max}
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
          {/* Here as well as on the orient step: drawing a property line round
              a five-acre lot is exactly when the whole boundary has to be on
              screen, and that is a wider photo rather than a smaller one. */}
          <MapZoomControls
            visible={origin != null}
            spanFeet={image?.realWidthFeet ?? null}
            mapZoom={mapZoom}
            busy={satelliteLoading}
            onStep={(steps) => refetchAtZoom(stepMapZoom(mapZoom, steps))}
          />

          {/* Only where there is a satellite photo to check against. Offering
              it on an uploaded photo would be a button that cannot do
              anything. */}
          {origin != null && image != null && !image.uploaded && (
            <button
              type="button"
              onClick={checkForNewerImagery}
              disabled={satelliteLoading}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${satelliteLoading ? "animate-spin" : ""}`} />
              {satelliteLoading ? "Checking\u2026" : "Check for newer imagery"}
            </button>
          )}

          {imageryNote && <p className="w-full text-xs text-muted-foreground">{imageryNote}</p>}
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
              {practice ? "Start over" : "Clear Saved Design"}
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
                          {zone.lengthFt != null && zone.widthFt != null && `${zone.lengthFt} × ${zone.widthFt} ft · `}
                          {formatMeasurements(measurements, zone)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {zone.service ? zoneServiceSummary(zone.service, catalog) : "Add service details"}
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
        practice={practice}
        catalog={catalog}
        initialLocation={dialogZone?.location ?? ""}
        // Every place named on this evaluation so far, so the next zone in
        // the front garden is a tap rather than a retype.
        otherLocations={zones.map((zone) => zone.location)}
        initialService={dialogZone?.service ?? null}
        initialLengthFt={dialogZone?.lengthFt ?? null}
        initialWidthFt={dialogZone?.widthFt ?? null}
        initialAreaSqFt={dialogZone?.areaSqFt ?? null}
        initialPerimeterFt={dialogZone?.perimeterFt ?? null}
        onSave={handleSaveZoneService}
        onCancel={() => setServiceDialogZoneId(null)}
      />

      {editingMark && (
        <MarkNoteDialog
          mark={editingMark}
          onSave={(note) => {
            setMarks((prev) => withoutEmpty(updateMark(prev, editingMark.id, note)));
            setEditingMark(null);
          }}
          onDelete={() => {
            setMarks((prev) => removeMark(prev, editingMark.id));
            setEditingMark(null);
          }}
          onCancel={() => {
            // A pin closed without anything written on it never existed.
            setMarks((prev) => withoutEmpty(prev));
            setEditingMark(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * What a pin says.
 *
 * Opens the moment a pin is dropped, because a pin with nothing on it is not
 * worth having and asking later means never asking.
 */
function MarkNoteDialog({
  mark,
  onSave,
  onDelete,
  onCancel,
}: {
  mark: CanvasMark;
  onSave: (note: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(mark.note);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
        <h2 className="text-lg font-semibold">Note on this spot</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          What the crew needs to know about here, the thing that is neither a zone nor a
          measurement.
        </p>

        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          autoFocus
          placeholder="Gate stays shut, dog in the back."
        />

        <div className="mt-3 flex gap-2">
          <Button type="button" className="flex-1" disabled={!note.trim()} onClick={() => onSave(note)}>
            Save
          </Button>
          {mark.note.trim() && (
            <Button type="button" variant="outline" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wider and Closer.
 *
 * These refetch rather than rescale. Scaling stops at the whole photo because
 * there is no more photo — the neighbour's fence is not in the file — so
 * seeing further means asking the map for a wider one.
 *
 * Shows how much ground is on the board, because "z16" means nothing and
 * "about 900 ft across" is the thing somebody is actually judging.
 *
 * Declared out here rather than inside the board: a component created during
 * render is a new component type every time, so React throws the old one away
 * and remounts it, and a button being rebuilt mid-tap is a button that misses
 * the tap.
 */
function MapZoomControls({
  visible,
  spanFeet,
  mapZoom,
  busy,
  onStep,
}: {
  visible: boolean;
  spanFeet: number | null;
  mapZoom: number;
  busy: boolean;
  onStep: (steps: number) => void;
}) {
  if (!visible) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">
        {spanFeet != null && spanFeet > 0
          ? `About ${Math.round(spanFeet).toLocaleString()} ft across`
          : "Show more ground"}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy || !canStepMapZoom(mapZoom, -1)}
        onClick={() => onStep(-1)}
      >
        <Minus className="h-3.5 w-3.5" />
        Wider
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy || !canStepMapZoom(mapZoom, 1)}
        onClick={() => onStep(1)}
      >
        <ZoomIn className="h-3.5 w-3.5" />
        Closer
      </Button>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
