"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Locate } from "lucide-react";

import { geometryPoints, projectToMiles } from "@/lib/attractor-geometry";
import { colorForAttractorType, colorForJobStatus, LOCATION_COLOR } from "./attractor-colors";
import type { AttractorWave, BusinessLocation, LatLng, LocationArea } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";

interface GalaxyViewProps {
  waves: AttractorWave[];
  jobs: JobWithLocation[];
  visibleWaveIds: Set<string>;
  selectedWaveId: string | null;
  onSelectWave: (id: string | null) => void;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  locations: BusinessLocation[];
  areas: LocationArea[];
  showLocations: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Shades an rgb triple toward white (amt > 0) or black (amt < 0), for
 * simple sphere-style highlight/shadow shading. */
function shade([r, g, b]: [number, number, number], amt: number): [number, number, number] {
  if (amt >= 0) return [r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt];
  return [r * (1 + amt), g * (1 + amt), b * (1 + amt)];
}

/** Deterministic pseudo-random in [0,1) from a seed + index, so the dust
 * texture is stable between renders instead of jittering. */
function noise(seed: string, i: number): number {
  let h = 0;
  const s = `${seed}:${i}`;
  for (let c = 0; c < s.length; c++) h = (h * 31 + s.charCodeAt(c)) >>> 0;
  return (h % 1000) / 1000;
}

const JOB_STATUS_SIZE: Record<string, number> = {
  estimating: 3,
  quoted: 5,
  approved: 7,
  in_progress: 9,
  completed: 12,
  cancelled: 4,
};

interface ProjectedWave {
  wave: AttractorWave;
  polygonPx: { x: number; y: number }[] | null;
  centerPx: { x: number; y: number };
  radiusPx: number;
}

interface ProjectedJob {
  job: JobWithLocation;
  x: number;
  y: number;
}

function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: [number, number, number]
) {
  const [r, g, b] = color;

  // Soft outer bloom.
  const bloom = ctx.createRadialGradient(x, y, 0, x, y, size * 6.5);
  bloom.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
  bloom.addColorStop(0.45, `rgba(${r},${g},${b},0.12)`);
  bloom.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, size * 6.5, 0, Math.PI * 2);
  ctx.fill();

  // Tighter, brighter corona.
  const corona = ctx.createRadialGradient(x, y, 0, x, y, size * 2.4);
  corona.addColorStop(0, "rgba(255,255,255,0.95)");
  corona.addColorStop(0.35, `rgba(${r},${g},${b},0.85)`);
  corona.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(x, y, size * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Diffraction spikes, tapering to transparent via a linear gradient stroke.
  const spikeLen = size * 3.8;
  function spike(dx: number, dy: number) {
    const grad = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  spike(spikeLen, 0);
  spike(0, spikeLen);
  spike(spikeLen * 0.55, spikeLen * 0.55);
  spike(spikeLen * 0.55, -spikeLen * 0.55);

  // Bright core.
  ctx.fillStyle = "#fffdf0";
  ctx.beginPath();
  ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
  ctx.fill();
}

export function GalaxyView({
  waves,
  jobs,
  visibleWaveIds,
  selectedWaveId,
  onSelectWave,
  selectedJobId,
  onSelectJob,
  locations,
  areas,
  showLocations,
}: GalaxyViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const projectedWavesRef = useRef<ProjectedWave[]>([]);
  const projectedJobsRef = useRef<ProjectedJob[]>([]);

  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ mouseX: number; mouseY: number; camX: number; camY: number } | null>(null);
  const lastDragMovedRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // A flat fill rather than a radial gradient: two very close, fully
    // opaque colors over a large area force the canvas rasterizer into
    // dithering the subtle transition, which shows up as a repeating
    // diagonal dot/dash pattern. A single solid color has no transition
    // to dither.
    ctx.fillStyle = "#070b1e";
    ctx.fillRect(0, 0, width, height);

    const allPoints: LatLng[] = [
      ...waves.flatMap((w) => geometryPoints(w.geometry_type, w.geometry)),
      ...jobs.map((j) => ({ lat: j.property.lat, lng: j.property.lng })),
      ...(showLocations ? locations.map((l) => ({ lat: l.lat, lng: l.lng })) : []),
      ...(showLocations ? areas.flatMap((a) => geometryPoints(a.geometry_type, a.geometry)) : []),
    ];

    if (allPoints.length === 0) {
      projectedWavesRef.current = [];
      projectedJobsRef.current = [];
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No Attractor Waves or projects with a location yet.", width / 2, height / 2);
      return;
    }

    const origin: LatLng = {
      lat: allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length,
      lng: allPoints.reduce((s, p) => s + p.lng, 0) / allPoints.length,
    };

    const projectedAll = allPoints.map((p) => projectToMiles(p, origin));
    const radiusPad = Math.max(
      waves.reduce((max, w) => {
        if (w.geometry_type === "point_radius") {
          const g = w.geometry as { radius_miles: number };
          return Math.max(max, g.radius_miles || 0);
        }
        return max;
      }, 0),
      showLocations
        ? areas.reduce((max, a) => {
            if (a.geometry_type === "point_radius") {
              const g = a.geometry as { radius_miles: number };
              return Math.max(max, g.radius_miles || 0);
            }
            return max;
          }, 0)
        : 0
    );

    const xs = projectedAll.map((p) => p.x);
    const ys = projectedAll.map((p) => p.y);
    const minX = Math.min(...xs) - radiusPad;
    const maxX = Math.max(...xs) + radiusPad;
    const minY = Math.min(...ys) - radiusPad;
    const maxY = Math.max(...ys) + radiusPad;
    const spanX = Math.max(maxX - minX, 0.5);
    const spanY = Math.max(maxY - minY, 0.5);

    const padding = 60;
    const fitScale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    const scale = fitScale * camera.zoom;
    const offsetX = width / 2 - ((minX + maxX) / 2) * scale + camera.x;
    const offsetY = height / 2 - ((minY + maxY) / 2) * scale + camera.y;

    function toPx(p: LatLng): { x: number; y: number } {
      const m = projectToMiles(p, origin);
      return { x: m.x * scale + offsetX, y: -m.y * scale + offsetY };
    }

    // --- Attractor dust clouds ---
    ctx.globalCompositeOperation = "lighter";
    const projectedWaves: ProjectedWave[] = [];
    for (const wave of waves) {
      if (!visibleWaveIds.has(wave.id)) continue;
      const points = geometryPoints(wave.geometry_type, wave.geometry);
      if (points.length === 0) continue; // e.g. zip_list — nothing to plot

      const isCompleted = wave.status === "completed";
      const [r, g, b] = isCompleted ? hexToRgb(colorForAttractorType(wave.type_id)) : [150, 150, 160];
      const glowAlpha = isCompleted ? 0.5 : 0.22;
      const isSelected = wave.id === selectedWaveId;

      let centerPx: { x: number; y: number };
      let radiusPx: number;
      let polygonPx: { x: number; y: number }[] | null = null;

      if (wave.geometry_type === "point_radius") {
        const geo = wave.geometry as { lat: number; lng: number; radius_miles: number };
        centerPx = toPx({ lat: geo.lat, lng: geo.lng });
        radiusPx = Math.max(geo.radius_miles * scale, 18);
      } else {
        const polygon = points.map((p) => toPx(p));
        polygonPx = polygon;
        centerPx = {
          x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
          y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
        };
        radiusPx = Math.max(...polygon.map((p) => Math.hypot(p.x - centerPx.x, p.y - centerPx.y)), 18);
      }

      // Several overlapping blurred blobs (instead of one flat circle) for a
      // nebula-like dust texture, seeded off the wave's id so it's stable.
      const blobCount = 6;
      for (let i = 0; i < blobCount; i++) {
        const angle = noise(wave.id, i) * Math.PI * 2;
        const dist = noise(wave.id, i + 50) * radiusPx * 0.55;
        const bx = centerPx.x + Math.cos(angle) * dist;
        const by = centerPx.y + Math.sin(angle) * dist;
        const br = radiusPx * (0.45 + noise(wave.id, i + 100) * 0.5);
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isSelected) {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        if (polygonPx) {
          ctx.moveTo(polygonPx[0].x, polygonPx[0].y);
          for (const p of polygonPx.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
        } else {
          ctx.arc(centerPx.x, centerPx.y, radiusPx, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = "lighter";
      }

      projectedWaves.push({ wave, polygonPx, centerPx, radiusPx });
    }
    projectedWavesRef.current = projectedWaves;

    // --- Projects, forming into planets ---
    ctx.globalCompositeOperation = "source-over";
    const projectedJobs: ProjectedJob[] = [];
    for (const job of jobs) {
      const { x, y } = toPx({ lat: job.property.lat, lng: job.property.lng });
      // Scale with zoom (sqrt-dampened) so zooming in actually lets you see
      // the planet up close instead of it staying a fixed pixel size.
      const size = (JOB_STATUS_SIZE[job.status] ?? 5) * Math.sqrt(camera.zoom);
      const color = colorForJobStatus(job.status);
      const [r, g, b] = hexToRgb(color);
      const isSelected = job.id === selectedJobId;

      const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 3.2);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, size * 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Sphere-shaded body: a radial gradient offset toward a fixed "light
      // source" (upper-left) gives the flat circle real dimensionality.
      const lightX = x - size * 0.35;
      const lightY = y - size * 0.35;
      const [hr, hg, hb] = shade([r, g, b], 0.6);
      const [dr, dg, db] = shade([r, g, b], -0.5);
      const sphere = ctx.createRadialGradient(lightX, lightY, 0, x, y, size * 1.2);
      sphere.addColorStop(0, `rgb(${hr},${hg},${hb})`);
      sphere.addColorStop(0.6, `rgb(${r},${g},${b})`);
      sphere.addColorStop(1, `rgb(${dr},${dg},${db})`);
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Small specular glint toward the light source, for a glossy look.
      const glint = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, size * 0.4);
      glint.addColorStop(0, "rgba(255,255,255,0.8)");
      glint.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glint;
      ctx.beginPath();
      ctx.arc(lightX, lightY, size * 0.4, 0, Math.PI * 2);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, size + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      projectedJobs.push({ job, x, y });
    }
    projectedJobsRef.current = projectedJobs;

    // --- Business locations = home-base stars, with their service areas ---
    if (showLocations) {
      ctx.globalCompositeOperation = "source-over";
      for (const area of areas) {
        const points = geometryPoints(area.geometry_type, area.geometry);
        if (points.length === 0) continue;

        let centerPx: { x: number; y: number };
        let radiusPx: number;
        let polygonPx: { x: number; y: number }[] | null = null;

        if (area.geometry_type === "point_radius") {
          const geo = area.geometry as { lat: number; lng: number; radius_miles: number };
          centerPx = toPx({ lat: geo.lat, lng: geo.lng });
          radiusPx = Math.max(geo.radius_miles * scale, 18);
        } else {
          const polygon = points.map((p) => toPx(p));
          polygonPx = polygon;
          centerPx = {
            x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
            y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
          };
          radiusPx = Math.max(...polygon.map((p) => Math.hypot(p.x - centerPx.x, p.y - centerPx.y)), 18);
        }

        ctx.strokeStyle = "rgba(251,191,36,0.55)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        if (polygonPx) {
          ctx.moveTo(polygonPx[0].x, polygonPx[0].y);
          for (const p of polygonPx.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
        } else {
          ctx.arc(centerPx.x, centerPx.y, radiusPx, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const location of locations) {
        const { x, y } = toPx({ lat: location.lat, lng: location.lng });
        drawStar(ctx, x, y, 6, hexToRgb(LOCATION_COLOR));
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(location.name, x, y + 24);
      }
    }
  }, [waves, jobs, visibleWaveIds, selectedWaveId, selectedJobId, locations, areas, showLocations, camera]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // Scroll to zoom toward the cursor. Registered as a native listener (not
  // React's onWheel) so preventDefault can actually stop page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setCamera((prev) => {
        const factor = Math.exp(-e.deltaY * 0.001);
        const zoom = Math.min(60, Math.max(0.3, prev.zoom * factor));
        const ratio = zoom / prev.zoom;
        return {
          zoom,
          x: cx - rect.width / 2 - (cx - rect.width / 2 - prev.x) * ratio,
          y: cy - rect.height / 2 - (cy - rect.height / 2 - prev.y) * ratio,
        };
      });
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  function handleMouseDown(e: MouseEvent<HTMLCanvasElement>) {
    dragRef.current = { mouseX: e.clientX, mouseY: e.clientY, camX: camera.x, camY: camera.y };
    lastDragMovedRef.current = false;
    setIsDragging(true);
  }

  function handleMouseMove(e: MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.mouseX;
    const dy = e.clientY - drag.mouseY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) lastDragMovedRef.current = true;
    setCamera((prev) => ({ ...prev, x: drag.camX + dx, y: drag.camY + dy }));
  }

  function endDrag() {
    dragRef.current = null;
    setIsDragging(false);
  }

  function resetView() {
    setCamera({ x: 0, y: 0, zoom: 1 });
  }

  function handleClick(e: MouseEvent<HTMLCanvasElement>) {
    if (lastDragMovedRef.current) {
      lastDragMovedRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const pj of projectedJobsRef.current) {
      if (Math.hypot(pj.x - x, pj.y - y) <= 14) {
        onSelectJob(pj.job.id);
        return;
      }
    }
    for (const pw of projectedWavesRef.current) {
      if (pw.polygonPx) {
        if (pointInPolygon({ x, y }, pw.polygonPx)) {
          onSelectWave(pw.wave.id);
          return;
        }
      } else if (Math.hypot(pw.centerPx.x - x, pw.centerPx.y - y) <= pw.radiusPx) {
        onSelectWave(pw.wave.id);
        return;
      }
    }
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        className={`h-full w-full ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      />
      <button
        type="button"
        onClick={resetView}
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white shadow-lg hover:bg-black/80"
      >
        <Locate className="h-3.5 w-3.5" />
        Reset view
      </button>
      <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white/70">
        Drag to pan · Scroll to zoom
      </p>
    </div>
  );
}
