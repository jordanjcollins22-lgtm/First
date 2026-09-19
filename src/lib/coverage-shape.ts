import { geometryToPolygon } from "@/lib/attractor-geometry";
import type { RelationshipStage } from "@/lib/house-relationship";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";

/**
 * A drawn shape, in the two forms the database can count houses inside.
 *
 * Every geometry the map draws -- a circle round an address, a hand-drawn
 * polygon, a buffered route -- becomes a ring of longitude/latitude pairs.
 * A ZIP list has no shape and stays a list of ZIPs. Either way the house count
 * is the database's, over the whole county, not a guess from what happened
 * to be on the page.
 */
export interface CoverageShape {
  ring: [number, number][] | null;
  zips: string[] | null;
}

export function shapeFor(type: AttractorGeometryType, geometry: AttractorGeometry): CoverageShape | null {
  if (type === "zip_list") {
    const zips = ((geometry as { zips?: string[] }).zips ?? [])
      .map((z) => z.trim().match(/^\d{5}/)?.[0])
      .filter((z): z is string => Boolean(z));
    return zips.length > 0 ? { ring: null, zips } : null;
  }
  const polygon = geometryToPolygon(type, geometry);
  const ring = polygon?.geometry.coordinates[0];
  if (!ring || ring.length < 4) return null;
  // Rounded so a ring of five hundred vertices travels as a few kilobytes,
  // and dropped to what a polygon needs: the closing vertex is implied.
  const rounded = ring.map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number]);
  const last = rounded[rounded.length - 1];
  const first = rounded[0];
  const open = last[0] === first[0] && last[1] === first[1] ? rounded.slice(0, -1) : rounded;
  return open.length >= 3 ? { ring: open, zips: null } : null;
}

/** What the database says about the doors inside a shape. */
export interface HouseCoverage {
  total: number;
  byStage: Record<RelationshipStage, number>;
  doNotContact: number;
  /** Total less do-not-contact: what to print and carry. */
  toHang: number;
  /** Doors that have never had a hanger. */
  firstTime: number;
  /** How many of each design to print. Design 1 is the introduction. */
  printRun: { design: number; count: number }[];
}

export function parseCoverage(raw: unknown): HouseCoverage {
  const r = (raw ?? {}) as {
    total?: number;
    by_stage?: Partial<Record<RelationshipStage, number>>;
    do_not_contact?: number;
    to_hang?: number;
    first_time?: number;
    print_run?: { design: number; count: number }[];
  };
  const stage = (k: RelationshipStage) => Number(r.by_stage?.[k] ?? 0);
  return {
    total: Number(r.total ?? 0),
    byStage: {
      untouched: stage("untouched"),
      spoken_to: stage("spoken_to"),
      evaluation: stage("evaluation"),
      proposal: stage("proposal"),
      client: stage("client"),
      job_completed: stage("job_completed"),
    },
    doNotContact: Number(r.do_not_contact ?? 0),
    toHang: Number(r.to_hang ?? 0),
    firstTime: Number(r.first_time ?? 0),
    printRun: (r.print_run ?? []).map((line) => ({ design: Number(line.design), count: Number(line.count) })),
  };
}

/** Clients, in the map's sense: anyone who has paid or had work done. */
export function clientDoors(coverage: HouseCoverage): number {
  return coverage.byStage.client + coverage.byStage.job_completed;
}

/** Doors we have had some contact with but who are not clients. */
export function warmDoors(coverage: HouseCoverage): number {
  return coverage.byStage.spoken_to + coverage.byStage.evaluation + coverage.byStage.proposal;
}
