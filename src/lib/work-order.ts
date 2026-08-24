/**
 * What the crew needs to do the job, and nothing else.
 *
 * The job page is the office's view: proposal totals, discounts, invoices,
 * margins. A crew member opening the job they are standing on should not be
 * reading the price of it — that is a conversation between the account manager
 * and the client, and a number the crew were never meant to quote from.
 *
 * So this assembles a separate thing from the same source data: the zones,
 * what to do in each, and what the evaluator photographed and marked there.
 * Nothing about loading the truck — tools and materials are the shop's
 * problem, and a list that goes stale is worse than none.
 * Money is not omitted from the display, it is absent from the shape — a work
 * order has nowhere to put a price, so no future change to a component can
 * leak one.
 */

import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { Point, WorkZone } from "@/components/canvas/types";

export interface ZonePhoto {
  /** Storage path in the canvas-images bucket. */
  path: string;
  /**
   * Where the evaluator tapped, as fractions of the image's width and height.
   *
   * Fractions rather than pixels because the crew see these on a phone and the
   * evaluator marked them on whatever they were holding — a pin stored in
   * pixels lands in the wrong place on every other screen.
   */
  markers: Point[];
}

export interface WorkOrderTask {
  label: string;
  value: string;
}

export interface WorkOrderZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
  /** What is being done here, e.g. "Mulch bed". */
  service: string;
  /** Where on the property, as the evaluator described it. */
  location: string;
  /** Size, for judging how long it takes and how much to load. */
  sizeLabel: string | null;
  /** The evaluator's checklist answers — the actual instructions. */
  tasks: WorkOrderTask[];
  notes: string;
  /**
   * What the evaluator photographed here, with whatever they marked on it.
   *
   * The single most useful thing on the sheet after the map. "Re-edge the bed"
   * is an instruction; the photo with a pin on the corner that has collapsed
   * is the instruction plus the answer to the question the crew were going to
   * ring about.
   */
  photos: ZonePhoto[];
}

export interface WorkOrder {
  zones: WorkOrderZone[];
}

function sizeLabelFor(zone: WorkZone): string | null {
  if (zone.lengthFt != null && zone.widthFt != null) {
    return `${zone.lengthFt} × ${zone.widthFt} ft`;
  }
  if (zone.areaSqFt != null) return `${Math.round(zone.areaSqFt).toLocaleString()} sq ft`;
  return null;
}

/**
 * Turns a saved design into a crew sheet.
 *
 * Zones with no service on them are dropped: an undecided shape is a drafting
 * artefact, and sending somebody to a zone with no instructions wastes a trip.
 */
export function buildWorkOrder(
  zones: WorkZone[],
  catalog: Pick<CanvasCatalog, "servicePricing">,
  /** Turns a checklist field key into the words the evaluator saw. Without it
   * the crew read raw keys, which is a worse instruction than none. */
  labelFor: (typeId: string, key: string) => string = (_typeId, key) => key
): WorkOrder {
  const serviceName = new Map(catalog.servicePricing.map((s) => [s.service_type_id, s.name]));

  const built: WorkOrderZone[] = [];

  for (const zone of zones) {
    if (!zone.service) continue;

    const typeId = zone.service.typeId;

    const tasks = Object.entries(zone.service.values ?? {})
      .filter(([, value]) => value !== "" && value != null)
      .map(([key, value]) => ({ label: labelFor(typeId, key), value }));

    built.push({
      id: zone.id,
      name: zone.name,
      color: zone.color,
      points: zone.points,
      service: serviceName.get(typeId) ?? typeId,
      location: zone.location,
      sizeLabel: sizeLabelFor(zone),
      tasks,
      notes: zone.service.notes ?? "",
      // Markers are keyed by the photo's own path, so a photo with none
      // simply has none — there is no separate "unmarked" state to handle.
      photos: (zone.service.photos ?? []).map((path) => ({
        path,
        markers: zone.service?.photoMarkers?.[path] ?? [],
      })),
    });
  }

  return { zones: built };
}

/**
 * The bounding box of every zone, for framing the site map.
 *
 * Padded so shapes do not sit flush against the edge, and clamped to the
 * canvas so the frame never shows space that was never drawn on.
 */
export function zonesBounds(
  zones: { points: Point[] }[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 40
): { x: number; y: number; width: number; height: number } {
  const points = zones.flatMap((z) => z.points);
  if (points.length === 0) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs) - padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxX = Math.min(canvasWidth, Math.max(...xs) + padding);
  const maxY = Math.min(canvasHeight, Math.max(...ys) + padding);

  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}
