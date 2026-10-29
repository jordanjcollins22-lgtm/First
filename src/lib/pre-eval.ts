import * as turf from "@turf/turf";

/** One spot the client marked: where it is, what they want done, and their photos. */
export interface PreEvalSpot {
  lng: number;
  lat: number;
  /** service_templates ids, or UNSURE_SERVICE when they want us to take a look. */
  services: string[];
  /** Paths in the pre-eval-photos bucket. */
  photos: string[];
}

export const PRE_EVAL_PHOTO_BUCKET = "pre-eval-photos";
export const UNSURE_SERVICE = "unsure";
export const MAX_SPOTS = 20;
export const MAX_PHOTOS_PER_SPOT = 6;
// Spots farther than this from the property are a mis-tap or a panned-away
// map, not part of the job.
export const MAX_SPOT_DISTANCE_METERS = 500;

interface ParseContext {
  preEvalId: string;
  property: { lng: number; lat: number };
  serviceIds: Set<string>;
}

/**
 * Validates spots coming from the public pre-eval page. Returns null if
 * anything is off, so a bad request never half-saves.
 */
export function parsePreEvalSpots(input: unknown, ctx: ParseContext): PreEvalSpot[] | null {
  if (!Array.isArray(input) || input.length > MAX_SPOTS) return null;

  const spots: PreEvalSpot[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const { lng, lat, services, photos } = raw as Record<string, unknown>;

    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    const meters = turf.distance([ctx.property.lng, ctx.property.lat], [lng, lat], { units: "meters" });
    if (meters > MAX_SPOT_DISTANCE_METERS) return null;

    if (!Array.isArray(services) || services.length === 0) return null;
    if (!services.every((s) => s === UNSURE_SERVICE || (typeof s === "string" && ctx.serviceIds.has(s)))) {
      return null;
    }

    // Photos must be ones uploaded for this pre-eval (see createPreEvalPhotoUpload).
    if (!Array.isArray(photos) || photos.length > MAX_PHOTOS_PER_SPOT) return null;
    if (!photos.every((p) => typeof p === "string" && isPhotoPathFor(ctx.preEvalId, p))) return null;

    spots.push({ lng, lat, services: [...new Set(services as string[])], photos: photos as string[] });
  }
  return spots;
}

export function isPhotoPathFor(preEvalId: string, path: string): boolean {
  return new RegExp(`^${preEvalId}/[0-9a-f-]{36}\\.jpg$`, "i").test(path);
}

/** Reads the stored jsonb column, dropping anything malformed. */
export function readStoredSpots(value: unknown): PreEvalSpot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s): PreEvalSpot[] => {
    if (typeof s !== "object" || s === null) return [];
    const { lng, lat, services, photos } = s as Record<string, unknown>;
    if (typeof lng !== "number" || typeof lat !== "number") return [];
    return [
      {
        lng,
        lat,
        services: Array.isArray(services) ? services.filter((x) => typeof x === "string") : [],
        photos: Array.isArray(photos) ? photos.filter((x) => typeof x === "string") : [],
      },
    ];
  });
}
