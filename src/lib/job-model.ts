/**
 * The 3D job model: the job's beds on the real satellite map, every plant in
 * them (kept, new, or coming out) at its real size, and the work as numbered
 * steps from the truck on, in the order the crew should do it.
 *
 * It is the training sheet as much as the plan: a new hire opens it before
 * the job and is walked through where to start and what comes next.
 *
 * Pure: geometry, the default order and the merging of the office's edits
 * are all here, tested without a map or a database.
 */

import * as turf from "@turf/turf";

export type LngLat = [number, number];

/* ----------------------------------------------------------------- plants */

export type PlantStatus = "keep" | "new" | "remove";

export const PLANT_STATUSES: PlantStatus[] = ["keep", "new", "remove"];

export const PLANT_STATUS_LABEL: Record<PlantStatus, string> = {
  keep: "Keep",
  new: "New",
  remove: "Remove",
};

/** Green to keep, teal-lime for new, red for coming out. */
export const PLANT_COLOR: Record<PlantStatus, string> = {
  keep: "#2f8f3a",
  new: "#2dd4bf",
  remove: "#dc2626",
};

export interface ModelPlant {
  id: string;
  /** Species or a plain name: "Boxwood", "Knock Out rose". */
  name: string;
  status: PlantStatus;
  heightFt: number;
  spreadFt: number;
  /** The bed it is in, when known. */
  areaId: string | null;
  /** Where it stands. Null until somebody places it. */
  at: LngLat | null;
  note?: string;
}

/** Sizes the map will draw, in feet: nothing invisible, nothing absurd. */
export const PLANT_SIZE_FT = { min: 0.5, maxHeight: 40, maxSpread: 30 } as const;

export function clampSize(value: unknown, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.min(max, Math.max(PLANT_SIZE_FT.min, n)) * 10) / 10;
}

const FT_TO_M = 0.3048;

/**
 * A plant as stacked rings, so a shrub reads as a rounded mound and a tree as
 * a tall one, at true scale: full spread at the bottom, narrower toward the
 * top. Heights in metres, as Mapbox's fill-extrusion wants them.
 */
export function plantShape(plant: ModelPlant): GeoJSON.Feature<GeoJSON.Polygon>[] {
  if (!plant.at) return [];
  const r = Math.max(PLANT_SIZE_FT.min, plant.spreadFt) / 2;
  const h = Math.max(PLANT_SIZE_FT.min, plant.heightFt) * FT_TO_M;
  const tiers: [number, number, number][] = [
    // [radius as a share of the spread, base, top] as shares of the height
    [1, 0, 0.6],
    [0.78, 0.6, 0.85],
    [0.45, 0.85, 1],
  ];
  return tiers.map(([share, base, top], i) => {
    const circle = turf.circle(plant.at!, r * share, { steps: 24, units: "feet" });
    return {
      type: "Feature",
      geometry: circle.geometry,
      properties: {
        id: plant.id,
        tier: i,
        status: plant.status,
        color: PLANT_COLOR[plant.status],
        base: Math.round(h * base * 100) / 100,
        height: Math.round(h * top * 100) / 100,
      },
    };
  });
}

/** A red X across a plant that is coming out, drawn on the ground. */
export function removalCross(plant: ModelPlant): GeoJSON.Feature<GeoJSON.MultiLineString> | null {
  if (!plant.at || plant.status !== "remove") return null;
  const r = Math.max(1, plant.spreadFt / 2 + 0.5);
  const corner = (bearing: number) => turf.destination(plant.at!, r, bearing, { units: "feet" }).geometry.coordinates as LngLat;
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: [[corner(-45), corner(135)], [corner(45), corner(-135)]] },
    properties: { id: plant.id },
  };
}

/** Every plant's 3D rings, removal crosses and name points, ready for the map's sources. */
export function plantLayers(plants: ModelPlant[]) {
  const placed = plants.filter((p) => p.at);
  return {
    shapes: turf.featureCollection(placed.flatMap(plantShape)),
    crosses: turf.featureCollection(placed.map(removalCross).filter((f): f is GeoJSON.Feature<GeoJSON.MultiLineString> => f != null)),
    labels: turf.featureCollection(
      placed.map((p) => turf.point(p.at!, { id: p.id, name: p.name, status: p.status, label: `${p.name} · ${PLANT_STATUS_LABEL[p.status]}` }))
    ),
  };
}

/** How many of each, for the legend. */
export function plantCounts(plants: ModelPlant[]): Record<PlantStatus, number> {
  const out: Record<PlantStatus, number> = { keep: 0, new: 0, remove: 0 };
  for (const p of plants) out[p.status] += 1;
  return out;
}

/* ------------------------------------------------------------------ areas */

export interface ModelArea {
  id: string;
  name: string;
  color: string;
  /** Its outline on the ground, closed or not. Empty when it could not be placed. */
  ring: LngLat[];
  /** The site map's service on it, e.g. "landscape-bed". */
  typeId: string | null;
  /** The evaluator's answers for that service. */
  values: Record<string, string>;
  /** "Mulch bed", for people. */
  service: string | null;
  /** As measured on site, when there was no outline to measure. */
  areaSqFt?: number | null;
  perimeterFt?: number | null;
}

function closed(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

export function hasShape(area: ModelArea): boolean {
  return area.ring.length >= 3;
}

export function areaPolygon(area: ModelArea): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (!hasShape(area)) return null;
  return turf.polygon([closed(area.ring)], { id: area.id, name: area.name, color: area.color });
}

/** The middle of an area, for its label and for plants not placed yet. */
export function areaCenter(area: ModelArea): LngLat | null {
  const poly = areaPolygon(area);
  if (!poly) return null;
  // Inside even for an L-shaped bed, which a plain centroid is not.
  return turf.pointOnFeature(poly).geometry.coordinates as LngLat;
}

export function areaSize(area: ModelArea): { sqft: number; perimeterFt: number } {
  const poly = areaPolygon(area);
  if (!poly) return { sqft: Math.max(0, area.areaSqFt ?? 0), perimeterFt: Math.max(0, area.perimeterFt ?? 0) };
  const sqft = turf.area(poly) * 10.7639;
  const perimeterFt = turf.length(turf.polygonToLine(poly) as GeoJSON.Feature<GeoJSON.LineString>, { units: "feet" });
  return { sqft: Math.round(sqft), perimeterFt: Math.round(perimeterFt) };
}

/** Which area a point is in, or null. */
export function areaAt(point: LngLat, areas: ModelArea[]): string | null {
  for (const area of areas) {
    const poly = areaPolygon(area);
    if (poly && turf.booleanPointInPolygon(point, poly)) return area.id;
  }
  return null;
}

export function areaLayers(areas: ModelArea[]) {
  const polys = areas.map(areaPolygon).filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => f != null);
  return {
    fills: turf.featureCollection(polys),
    labels: turf.featureCollection(
      areas.flatMap((a, i) => {
        const c = areaCenter(a);
        return c ? [turf.point(c, { id: a.id, label: `${i + 1}. ${a.name}` })] : [];
      })
    ),
  };
}

/** Distance in feet. */
export function feetBetween(a: LngLat, b: LngLat): number {
  return turf.distance(a, b, { units: "feet" });
}

/** The corner of an area nearest the truck: where the crew walk in. */
export function startPoint(area: ModelArea, from: LngLat | null): LngLat | null {
  if (!hasShape(area)) return null;
  if (!from) return areaCenter(area);
  let best = area.ring[0];
  let bestD = Infinity;
  for (const p of area.ring) {
    const d = feetBetween(p, from);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  // A step's pin sits just inside the bed, not on its edge line.
  const c = areaCenter(area)!;
  return [best[0] + (c[0] - best[0]) * 0.12, best[1] + (c[1] - best[1]) * 0.12];
}

/**
 * Plants with no place yet (from the photos) are put in their bed's middle,
 * spread around it in a small spiral so they don't sit on top of each other,
 * for the office to drag into place. Plants with no bed stay unplaced.
 */
export function placeUnplaced(plants: ModelPlant[], areas: ModelArea[]): ModelPlant[] {
  const used = new Map<string, number>();
  return plants.map((p) => {
    if (p.at || !p.areaId) return p;
    const area = areas.find((a) => a.id === p.areaId);
    const c = area ? areaCenter(area) : null;
    if (!c) return p;
    const n = used.get(p.areaId) ?? 0;
    used.set(p.areaId, n + 1);
    if (n === 0) return { ...p, at: c };
    const at = turf.destination(c, 2.5 * Math.sqrt(n), n * 137.5, { units: "feet" }).geometry.coordinates as LngLat;
    return { ...p, at };
  });
}

/* ------------------------------------------------------------------ steps */

/**
 * The order a landscaping job goes in. Trimming comes before removal so the
 * clippings fall where the cleanup already has to go; fabric before plants
 * and plants before mulch, so nothing is buried or dug through twice.
 */
export const STEP_KINDS = ["walkthrough", "setup", "trim", "remove", "weed", "edge", "fabric", "plant", "other", "mulch", "cleanup", "inspect"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_TOOLS: Record<StepKind, string[]> = {
  walkthrough: ["Phone with this model", "Marking flags"],
  setup: ["Tarps", "Wheelbarrows", "Cones"],
  trim: ["Hedge trimmer", "Hand pruners", "Tarp"],
  remove: ["Spade", "Loppers", "Mattock", "Tarp"],
  weed: ["Stirrup hoe", "Hand weeder", "Debris bags"],
  edge: ["Half-moon edger", "Flat shovel"],
  fabric: ["Landscape fabric", "Fabric staples", "Utility knife"],
  plant: ["Spade", "Garden soil", "Hose"],
  other: [],
  mulch: ["Pitchfork", "Wheelbarrow", "Bow rake"],
  cleanup: ["Blower", "Broom", "Tarps"],
  inspect: ["Phone for after photos"],
};

export interface ModelStep {
  /** Stable, from what and where: "edge:zone-3", "setup:site". */
  id: string;
  kind: StepKind;
  title: string;
  /** The area it happens in; null for the whole site. */
  areaId: string | null;
  minutes: number;
  tools: string[];
  /** Where to stand to start it. */
  at: LngLat | null;
}

/** What the office changed on a step, kept by its id. */
export interface StepEdit {
  id: string;
  title?: string;
  minutes?: number;
  tools?: string[];
}

const SITE = "site";

function isNone(v: string | undefined): boolean {
  return !v || v === "None" || v === "Existing Good Edge";
}

/** What each area needs done, from its service and its plants. */
export function areaWork(area: ModelArea, plants: ModelPlant[]): { kind: StepKind; title: string; minutes: number; tools?: string[] }[] {
  const v = area.values ?? {};
  const mine = plants.filter((p) => p.areaId === area.id);
  const removing = mine.filter((p) => p.status === "remove");
  const adding = mine.filter((p) => p.status === "new");
  const { sqft, perimeterFt } = areaSize(area);
  const per = (rate: number, min: number) => Math.max(min, Math.round(sqft / rate));
  const plantMinutes = (list: ModelPlant[], base: number) => list.reduce((sum, p) => sum + base + Math.round(Math.min(30, p.spreadFt * 2)), 0);
  const out: { kind: StepKind; title: string; minutes: number; tools?: string[] }[] = [];
  const type = area.typeId;

  if (type === "trimming" || (type === "landscape-bed" && !isNone(v.bushTrimming))) {
    out.push({ kind: "trim", title: `Trim the bushes${type === "trimming" && v.quantity ? ` (${v.quantity})` : ""}`, minutes: Math.max(15, Number(v.quantity) * 8 || 20) });
  }
  const debris = type === "landscape-cleanup" || type === "leaf-seasonal-cleanup" || v.existingMaterialCondition === "Needs Removal";
  if (removing.length > 0 || type === "plant-bush-removal" || (type === "landscape-bed" && (!isNone(v.bushRemoval) || !isNone(v.plantRemoval)))) {
    const names = removing.map((p) => p.name);
    out.push({
      kind: "remove",
      title: names.length ? `Take out ${listOf(names)}${debris ? " and the old material" : ""}` : `Take out the plants marked for removal${debris ? " and the old material" : ""}`,
      minutes: Math.max(15, plantMinutes(removing, 10) || Number(v.quantity) * 15 || 20),
      tools: debris ? [...STEP_TOOLS.remove, "Debris bags"] : undefined,
    });
  } else if (debris) {
    out.push({ kind: "remove", title: type === "leaf-seasonal-cleanup" ? "Clear the leaves" : "Clear the debris and old material", minutes: per(60, 15), tools: ["Rake", "Tarp", "Blower", "Debris bags"] });
  }
  const bed = type === "landscape-bed";
  if (bed) {
    const heavy = v.weedLevel === "Heavy" ? 2 : v.weedLevel === "Moderate" ? 1.4 : 1;
    out.push({ kind: "weed", title: v.bedWork === "New Creation" ? "Strip the sod and prep the new bed" : "Weed and prep the bed", minutes: Math.max(10, Math.round((sqft / 40) * heavy)) });
    if (!isNone(v.edge)) out.push({ kind: "edge", title: v.edge === "No Edge" ? "Cut a new edge" : "Re-cut the edge", minutes: Math.max(10, Math.round(perimeterFt / 5)) });
    if (v.material === "Rock") out.push({ kind: "fabric", title: "Lay fabric under the rock", minutes: per(60, 10) });
  }
  if (adding.length > 0 || type === "plant-installation" || (bed && !isNone(v.newPlantInstallation))) {
    const names = adding.map((p) => p.name);
    out.push({ kind: "plant", title: names.length ? `Plant ${listOf(names)}` : "Plant the new plants", minutes: Math.max(15, plantMinutes(adding, 15) || Number(v.quantity) * 20 || 20) });
  }
  if (type && !bed && !["trimming", "plant-bush-removal", "plant-installation", "landscape-cleanup", "leaf-seasonal-cleanup"].includes(type)) {
    out.push({ kind: "other", title: area.service ?? "Do the work on the site map", minutes: per(50, 20) });
  }
  if (bed && v.material) {
    const rock = v.material === "Rock";
    const what = rock ? `${v.rockSize ? `${v.rockSize.toLowerCase()} ` : ""}river rock` : `${v.color ? `${v.color.toLowerCase()} ` : ""}mulch`;
    out.push({ kind: "mulch", title: `Spread the ${what}`, minutes: per(rock ? 15 : 25, 10), tools: [...STEP_TOOLS.mulch, rock ? "River rock" : `Mulch${v.color ? ` (${v.color.toLowerCase()})` : ""}`] });
  }
  return out;
}

function listOf(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts].map(([n, c]) => (c > 1 ? `${c} × ${n}` : `the ${n}`));
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more`;
}

/**
 * Areas in the order to walk them: nearest the truck first, then whichever
 * is nearest the last one, so the crew never cross the yard twice.
 */
export function walkOrder(areas: ModelArea[], truck: LngLat | null): ModelArea[] {
  const left = [...areas];
  const out: ModelArea[] = [];
  let here = truck;
  while (left.length > 0) {
    let pick = 0;
    if (here) {
      let best = Infinity;
      left.forEach((a, i) => {
        const p = startPoint(a, here) ?? areaCenter(a);
        const d = p ? feetBetween(here!, p) : Infinity;
        if (d < best) {
          best = d;
          pick = i;
        }
      });
    }
    const [next] = left.splice(pick, 1);
    out.push(next);
    here = (here ? startPoint(next, here) : areaCenter(next)) ?? here;
  }
  return out;
}

/**
 * The default plan: walk the job, set up, then each kind of work across every
 * area that needs it (trim, remove, weed and prep, edge, fabric, plant, mulch),
 * areas nearest the truck first and each entered at its corner nearest the
 * truck, then clean up and check it.
 */
export function defaultSteps(areas: ModelArea[], plants: ModelPlant[], truck: LngLat | null): ModelStep[] {
  const ordered = walkOrder(areas, truck);
  const site = truck ?? (ordered.map(areaCenter).find((c) => c) || null);
  const work = new Map(ordered.map((a) => [a.id, areaWork(a, plants)]));
  const steps: ModelStep[] = [
    { id: `walkthrough:${SITE}`, kind: "walkthrough", title: "Walk the job with this model: what stays, what goes, where it all goes", areaId: null, minutes: 10, tools: STEP_TOOLS.walkthrough, at: site },
    { id: `setup:${SITE}`, kind: "setup", title: "Park, unload, lay tarps by the first bed", areaId: null, minutes: 15, tools: STEP_TOOLS.setup, at: site },
  ];
  for (const kind of STEP_KINDS) {
    if (kind === "walkthrough" || kind === "setup" || kind === "cleanup" || kind === "inspect") continue;
    for (const area of ordered) {
      for (const w of work.get(area.id) ?? []) {
        if (w.kind !== kind) continue;
        steps.push({
          id: `${kind}:${area.id}`,
          kind,
          title: w.title,
          areaId: area.id,
          minutes: w.minutes,
          tools: w.tools ?? STEP_TOOLS[kind],
          at: startPoint(area, truck),
        });
      }
    }
  }
  steps.push(
    { id: `cleanup:${SITE}`, kind: "cleanup", title: "Blow off the hard surfaces, haul the debris, load the truck", areaId: null, minutes: 15 + 3 * ordered.length, tools: STEP_TOOLS.cleanup, at: site },
    { id: `inspect:${SITE}`, kind: "inspect", title: "Walk it again against this model and take the after photos", areaId: null, minutes: 10, tools: STEP_TOOLS.inspect, at: site }
  );
  return steps;
}

/**
 * The office's order and changes laid over today's defaults. Steps the office
 * placed keep their place; a step that is new since (a plant added, a service
 * changed) goes in after the step it follows by default. A saved step whose
 * work is gone is dropped.
 */
export function applyStepEdits(defaults: ModelStep[], edits: StepEdit[] | null | undefined): ModelStep[] {
  if (!edits || edits.length === 0) return defaults;
  const byId = new Map(defaults.map((s) => [s.id, s]));
  const out: ModelStep[] = [];
  for (const e of edits) {
    const s = byId.get(e.id);
    if (!s || out.some((o) => o.id === s.id)) continue;
    out.push({
      ...s,
      title: e.title?.trim() ? e.title.trim().slice(0, 200) : s.title,
      minutes: e.minutes != null && Number.isFinite(e.minutes) && e.minutes > 0 ? Math.min(600, Math.round(e.minutes)) : s.minutes,
      tools: Array.isArray(e.tools) ? e.tools.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : s.tools,
    });
  }
  defaults.forEach((s, i) => {
    if (out.some((o) => o.id === s.id)) return;
    // After the nearest earlier default that is placed; first when none is.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => o.id === defaults[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, s);
  });
  return out;
}

/** What is kept for a list of steps: the order, and only what differs from the default. */
export function stepEditsOf(steps: ModelStep[], defaults: ModelStep[]): StepEdit[] {
  const byId = new Map(defaults.map((s) => [s.id, s]));
  return steps.map((s) => {
    const d = byId.get(s.id);
    const e: StepEdit = { id: s.id };
    if (!d || d.title !== s.title) e.title = s.title;
    if (!d || d.minutes !== s.minutes) e.minutes = s.minutes;
    if (!d || d.tools.join("|") !== s.tools.join("|")) e.tools = s.tools;
    return e;
  });
}

/** One step moved from one place to another. */
export function moveStep<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

export function totalMinutes(steps: ModelStep[]): number {
  return steps.reduce((sum, s) => sum + s.minutes, 0);
}

export function sayMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Step pins: steps at the same spot share one pin (the walkthrough and the
 * setup both start at the truck), labelled "1·2".
 */
export function stepPins(steps: ModelStep[]): { at: LngLat; numbers: number[]; ids: string[] }[] {
  const pins: { at: LngLat; numbers: number[]; ids: string[] }[] = [];
  steps.forEach((s, i) => {
    if (!s.at) return;
    const same = pins.find((p) => feetBetween(p.at, s.at!) < 1.5);
    if (same) {
      same.numbers.push(i + 1);
      same.ids.push(s.id);
    } else {
      pins.push({ at: s.at, numbers: [i + 1], ids: [s.id] });
    }
  });
  return pins;
}

/** The path from step to step, for the dashed line on the map. */
export function stepPath(steps: ModelStep[]): GeoJSON.Feature<GeoJSON.LineString> | null {
  const points: LngLat[] = [];
  for (const s of steps) {
    if (!s.at) continue;
    const last = points[points.length - 1];
    if (last && feetBetween(last, s.at) < 1.5) continue;
    points.push(s.at);
  }
  return points.length >= 2 ? turf.lineString(points) : null;
}

/** Compass degrees from one point to another. */
export function bearingBetween(a: LngLat, b: LngLat): number {
  return (turf.bearing(a, b) + 360) % 360;
}

/**
 * Where the camera goes for a step: over the spot, tilted, looking the way
 * the crew would be walking from the step before. Falls back to the given
 * bearing when the step starts where the last one did.
 */
export function cameraFor(steps: ModelStep[], index: number, fallbackBearing: number): { center: LngLat; zoom: number; pitch: number; bearing: number } | null {
  const s = steps[index];
  if (!s?.at) return null;
  let bearing = fallbackBearing;
  for (let j = index - 1; j >= 0; j--) {
    const prev = steps[j].at;
    if (prev && feetBetween(prev, s.at) >= 3) {
      bearing = bearingBetween(prev, s.at);
      break;
    }
  }
  return { center: s.at, zoom: s.areaId ? 20.6 : 19.6, pitch: 62, bearing: Math.round(bearing) };
}

/** A box around everything on the model, for the first view. */
export function modelBounds(areas: ModelArea[], plants: ModelPlant[], truck: LngLat | null): [LngLat, LngLat] | null {
  const pts: LngLat[] = [...areas.flatMap((a) => a.ring), ...plants.flatMap((p) => (p.at ? [p.at] : [])), ...(truck ? [truck] : [])];
  if (pts.length === 0) return null;
  const [w, s, e, n] = turf.bbox(turf.multiPoint(pts));
  return [
    [w, s],
    [e, n],
  ];
}

/* -------------------------------------------------------------- the saved */

/** What is kept per job. */
export interface StoredJobModel {
  plants: ModelPlant[];
  steps: StepEdit[];
  truck: LngLat | null;
  videoUrl: string | null;
}

export const EMPTY_MODEL: StoredJobModel = { plants: [], steps: [], truck: null, videoUrl: null };

function lngLatOf(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lng, lat] = v.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

/** A saved model as the database or the browser sent it, cleaned. Never throws. */
export function cleanModel(raw: unknown): StoredJobModel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const plants = (Array.isArray(o.plants) ? o.plants : []).slice(0, 300).flatMap((p): ModelPlant[] => {
    const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id.slice(0, 64) : "";
    const name = typeof x.name === "string" ? x.name.trim().slice(0, 80) : "";
    if (!id || !name) return [];
    const status = PLANT_STATUSES.includes(x.status as PlantStatus) ? (x.status as PlantStatus) : "keep";
    return [
      {
        id,
        name,
        status,
        heightFt: clampSize(x.heightFt, PLANT_SIZE_FT.maxHeight, 3),
        spreadFt: clampSize(x.spreadFt, PLANT_SIZE_FT.maxSpread, 3),
        areaId: typeof x.areaId === "string" && x.areaId ? x.areaId.slice(0, 64) : null,
        at: lngLatOf(x.at),
        ...(typeof x.note === "string" && x.note.trim() ? { note: x.note.trim().slice(0, 300) } : {}),
      },
    ];
  });
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 200).flatMap((s): StepEdit[] => {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id) return [];
    const e: StepEdit = { id: x.id.slice(0, 120) };
    if (typeof x.title === "string" && x.title.trim()) e.title = x.title.trim().slice(0, 200);
    if (typeof x.minutes === "number" && Number.isFinite(x.minutes) && x.minutes > 0) e.minutes = Math.min(600, Math.round(x.minutes));
    if (Array.isArray(x.tools)) e.tools = x.tools.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 12);
    return [e];
  });
  const video = typeof o.videoUrl === "string" ? o.videoUrl.trim() : "";
  return {
    plants,
    steps,
    truck: lngLatOf(o.truck),
    videoUrl: /^https?:\/\//i.test(video) ? video.slice(0, 1000) : null,
  };
}

/* ------------------------------------------------------ photo suggestions */

export interface PlantSuggestion {
  name: string;
  status: "keep" | "remove";
  heightFt: number;
  spreadFt: number;
  areaId: string | null;
  why: string;
}

/** The shape Claude answers in, as a JSON schema for structured output. */
export function suggestionSchema(areaIds: string[]) {
  return {
    type: "object",
    properties: {
      plants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Common name, species if you can tell, e.g. 'Boxwood' or 'Japanese holly'." },
            status: { type: "string", enum: ["keep", "remove"] },
            heightFt: { type: "number", description: "Rough height in feet." },
            spreadFt: { type: "number", description: "Rough width in feet." },
            areaId: { type: "string", enum: [...areaIds, "unknown"] },
            why: { type: "string", description: "Under 12 words: why keep or remove it." },
          },
          required: ["name", "status", "heightFt", "spreadFt", "areaId", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["plants"],
    additionalProperties: false,
  };
}

/** Claude's answer, cleaned: sizes clamped, unknown beds dropped to none, at most 40. */
export function parseSuggestions(raw: string, areaIds: string[]): PlantSuggestion[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (data as { plants?: unknown })?.plants;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).flatMap((p): PlantSuggestion[] => {
    const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const name = typeof x.name === "string" ? x.name.trim().slice(0, 80) : "";
    if (!name) return [];
    return [
      {
        name,
        status: x.status === "remove" ? "remove" : "keep",
        heightFt: clampSize(x.heightFt, PLANT_SIZE_FT.maxHeight, 3),
        spreadFt: clampSize(x.spreadFt, PLANT_SIZE_FT.maxSpread, 3),
        areaId: typeof x.areaId === "string" && areaIds.includes(x.areaId) ? x.areaId : null,
        why: typeof x.why === "string" ? x.why.trim().slice(0, 140) : "",
      },
    ];
  });
}

export function suggestionPrompt(areas: { id: string; name: string; service: string | null }[]): string {
  return [
    "These are photos of a client's landscape beds, taken before a landscaping job.",
    "List every distinct shrub, tree, perennial or ornamental grass you can see in the beds (not the lawn, not weeds).",
    "For each: a common name (species when you can tell), keep or remove, a rough height and spread in feet, and which area it is in.",
    "Mark remove only for plants that are dead, dying, badly overgrown for the spot, invasive, or clearly being cleared; otherwise keep.",
    "One entry per plant: three boxwoods in a row are three entries.",
    "The areas:",
    ...areas.map((a) => `- ${a.id}: ${a.name}${a.service ? ` (${a.service})` : ""}`),
    "Use areaId 'unknown' when you can't tell which area a photo shows.",
  ].join("\n");
}
