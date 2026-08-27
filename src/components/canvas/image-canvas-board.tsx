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
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Home,
  ImageUp,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MousePointer2,
  PenTool,
  RotateCcw,
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
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { autoBearing, describeHeading, normalizeDegrees } from "@/lib/orientation";
import { coverScale, visibleWidthFeet, zoomAdjustmentFor } from "@/lib/canvas-cover";
import { nearbyRoads } from "@/lib/mapbox-roads";
import { drawFrontTarget } from "@/lib/canvas-front-target";
import { loadDesign, saveDesign, clearDesign } from "@/lib/canvas-storage";
import { createClient } from "@/lib/supabase/client";
import { saveCanvasDesign } from "@/lib/actions/canvas-design-actions";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { SatelliteAddressSearch } from "./satellite-address-search";
import { ZoneServiceDialog } from "./zone-service-dialog";
import { serviceTypeById } from "./service-catalog";
import type { Point, WorkZone, ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";
import { formatMeasurements, zoneMeasurements } from "@/lib/proposal-pricing";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas-dimensions";

const CLOSE_POINT_RADIUS = 12;
const ZONE_COLORS = ["#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const EARTH_METERS_PER_TILE_PIXEL_AT_EQUATOR_Z0 = 156543.03392;

/** Mapbox's limit on a static image's side, and what we ask for. Square, so
 * there is photo under the corners whichever way it is turned. */
const SATELLITE_REQUEST_SIZE = 1280;

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

function zoneServiceSummary(service: ZoneServiceData, catalog: CanvasCatalog): string {
  return (
    catalog.servicePricing.find((p) => p.service_type_id === service.typeId)?.name ??
    serviceTypeById(service.typeId)?.label ??
    "Details added"
  );
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
  // Where the photo came from and which way it is turned. Kept so the
  // evaluator can nudge the turn and get a fresh, full-frame photo back
  // rather than a rotated one with white corners.
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [bearing, setBearing] = useState(0);
  const [orientConfirmed, setOrientConfirmed] = useState(true);
  const [keepCentered, setKeepCentered] = useState(true);
  const [autoTurned, setAutoTurned] = useState<number | null>(null);
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
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
    }

    // While the house is being pointed the right way, a target at the bottom
    // of the board saying which way is "the front".
    if (showFrontTarget) drawFrontTarget(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);

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
  }, [image, zones, propertyLine, houseOutline, tool, drawingPoints, cursorPos, showFrontTarget]);

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
  }, [jobId, image, locked, address, zones, propertyLine, houseOutline, bearing, orientConfirmed]);

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
            imageBearing: bearing,
            orientationConfirmed: orientConfirmed,
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
  }, [jobId, image, locked, address, zones, propertyLine, houseOutline, bearing, orientConfirmed]);

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

  async function loadImageBlob(blob: Blob, realWidthFeet: number | null = null) {
    const element = await loadImageElement(blob);
    // Scaled to cover the board's diagonal rather than to fit inside it, so
    // there is photo under every corner however far it is turned. Fitting is
    // what put the white triangles there.
    const scale = coverScale(element.width, element.height, CANVAS_WIDTH, CANVAS_HEIGHT);
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
    lat: number,
    mapBearing = 0
  ): Promise<{ blob: Blob; realWidthFeet: number }> {
    // Mapbox requires its logo/attribution on static images, anchored to the
    // bottom edge. Fetch extra vertical padding, split evenly so the requested
    // lat/lng stays vertically centered in the final crop (cropping only from
    // the bottom would push the property off-center), and trim it back off
    // after loading.
    //
    // A square is requested rather than a board-shaped rectangle so there is
    // photo under the corners when it turns. 1280 a side is Mapbox's limit.
    const padding = 220;
    const request = SATELLITE_REQUEST_SIZE;
    const keptHeight = request - padding;

    // Scaling up to fill the corners means seeing less ground, so the photo is
    // fetched from further out by exactly that much. The badge then reads
    // about the same as it always did.
    const zoom = BASE_SATELLITE_ZOOM - zoomAdjustmentFor(
      coverScale(request, keptHeight, CANVAS_WIDTH, CANVAS_HEIGHT)
    );

    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},${mapBearing}/${request}x${request}@2x?access_token=${env.mapboxToken}`;
    const res = await fetch(url);
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
        else resolve({ blob, realWidthFeet });
      }, "image/png");
    });
  }

  async function handleSelectSatelliteLocation(suggestion: GeocodeSuggestion) {
    setSatelliteError(null);
    setSatelliteLoading(true);
    try {
      const point = { lat: suggestion.lat, lng: suggestion.lng };

      // Turn the map before fetching rather than turning the photo after.
      // A photo requested at a bearing fills its frame; a photo rotated on
      // the canvas has white corners where the yard should be.
      let turned = 0;
      try {
        const guess = autoBearing(point, await nearbyRoads(point));
        if (guess != null) turned = guess;
        setAutoTurned(guess);
      } catch {
        // No street data is not a failure — it just means the evaluator
        // turns it themselves, which is the next thing they are asked to do.
        setAutoTurned(null);
      }

      const { blob, realWidthFeet } = await fetchSatelliteImageBlob(
        suggestion.lng,
        suggestion.lat,
        turned
      );
      await loadImageBlob(blob, realWidthFeet);
      setOrigin(point);
      setBearing(turned);
      setOrientConfirmed(false);
      setKeepCentered(true);
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
  }

  function handleSaveZoneService(
    location: string,
    service: ZoneServiceData | null,
    lengthFt: number | null,
    widthFt: number | null,
    areaSqFt: number | null,
    perimeterFt: number | null
  ) {
    setZones((prev) =>
      prev.map((zone) =>
        zone.id === serviceDialogZoneId
          ? { ...zone, location, service, lengthFt, widthFt, areaSqFt, perimeterFt }
          : zone
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

    // Held in the middle on purpose while orienting: the house is under the
    // centre of the frame, and a board that drifts is one where "point the
    // front at the bottom" stops meaning anything.
    if (locked || holdCentered || !image) return;
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

    if (locked || holdCentered || !dragRef.current || !image) return;
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
                ? `Turned automatically — the street looked to be ${describeHeading(
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
              {!keepCentered && " — off, so you can drag the photo"}
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
              Front is down — lock it
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowSatelliteSearch(true)}>
              Different address
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
                          {zone.lengthFt != null && zone.widthFt != null && `${zone.lengthFt} × ${zone.widthFt} ft · `}
                          {formatMeasurements(measurements)}
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
        catalog={catalog}
        initialLocation={dialogZone?.location ?? ""}
        initialService={dialogZone?.service ?? null}
        initialLengthFt={dialogZone?.lengthFt ?? null}
        initialWidthFt={dialogZone?.widthFt ?? null}
        initialAreaSqFt={dialogZone?.areaSqFt ?? null}
        initialPerimeterFt={dialogZone?.perimeterFt ?? null}
        onSave={handleSaveZoneService}
        onCancel={() => setServiceDialogZoneId(null)}
      />

    </div>
  );
}
