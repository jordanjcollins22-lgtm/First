import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { boardToGround, centroidOf, type ImageGeo, type LotData } from "@/lib/lot-map";
import { cleanModel, EMPTY_MODEL, type LngLat, type ModelArea, type StoredJobModel } from "@/lib/job-model";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import type { WorkZone } from "@/components/canvas/types";

/**
 * A job's 3D model, against the database: its beds off the site map, put
 * back on the ground; the plants, order and truck spot the office saved; and
 * the photos to suggest plants from.
 *
 * Works before migration 0372: with no table the model is empty and `ready`
 * is false, so the page shows the beds and the default order and says it
 * can't save yet.
 */

// The table is newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export interface ModelPhoto {
  url: string;
  areaId: string | null;
  /** Where to fetch it from on the server, for the suggestions. */
  bucket: "canvas-images" | "job-photos";
  path: string;
}

export interface JobModelData {
  jobId: string;
  address: string;
  /** The property's pin, for when there are no beds to frame. */
  pin: LngLat | null;
  /** The house's outline from the county, when known. */
  house: LngLat[] | null;
  /** Where the truck goes when nobody has said: the road in front of the house, else the pin. */
  defaultTruck: LngLat | null;
  areas: ModelArea[];
  /** Beds on the site map that could not be put on the ground (an uploaded photo has no place on the map). */
  unplacedAreas: number;
  stored: StoredJobModel;
  /** The table exists, so saving works. */
  ready: boolean;
  photos: ModelPhoto[];
}

/** The site map's areas on the ground, when its photo came from the satellite. */
export function areasFromDesign(zones: WorkZone[], design: { image_geo?: unknown; image_uploaded?: boolean; image_x: number; image_y: number; image_scale: number; image_rotation: number } | null): { areas: ModelArea[]; unplaced: number } {
  const geo = design?.image_geo as ImageGeo | null | undefined;
  const placeable = Boolean(geo && !design?.image_uploaded && Number.isFinite(geo.lng) && Number.isFinite(geo.request));
  const areas: ModelArea[] = [];
  let unplaced = 0;
  for (const zone of zones) {
    if (!zone.service) continue;
    const ring =
      placeable && design && zone.points.length >= 3
        ? zone.points.map((p) =>
            boardToGround(p, geo!, {
              x: design.image_x,
              y: design.image_y,
              scale: design.image_scale,
              rotation: design.image_rotation,
              // The satellite photo is fetched at 2x the size asked for.
              elementWidth: geo!.request * 2,
            })
          )
        : [];
    if (ring.length === 0) unplaced += 1;
    areas.push({
      id: zone.id,
      name: zone.name || "Area",
      color: zone.color || "#f59e0b",
      ring,
      typeId: zone.service.typeId,
      values: zone.service.values ?? {},
      service: serviceTypeById(zone.service.typeId)?.label ?? zone.service.typeId,
      areaSqFt: zone.areaSqFt,
      perimeterFt: zone.perimeterFt,
    });
  }
  return { areas, unplaced };
}

/** The saved model, or the empty one, and whether the table is there. */
export async function readJobModel(client: unknown, jobId: string): Promise<{ stored: StoredJobModel; ready: boolean }> {
  const { data, error } = await untyped(client).from("job_models").select("plants, steps, truck, video_url").eq("job_id", jobId).maybeSingle();
  if (error) return { stored: EMPTY_MODEL, ready: false };
  if (!data) return { stored: EMPTY_MODEL, ready: true };
  const row = data as { plants: unknown; steps: unknown; truck: unknown; video_url: string | null };
  return { stored: cleanModel({ plants: row.plants, steps: row.steps, truck: row.truck, videoUrl: row.video_url }), ready: true };
}

const PHOTO_URL_SECONDS = 60 * 60;

export async function loadJobModel(jobId: string): Promise<JobModelData | null> {
  const supabase = await createClient();
  const [{ data: job }, design, model, { data: jobPhotos }] = await Promise.all([
    supabase.from("jobs").select("id, name, property:properties(address, lat, lng, parcel)").eq("id", jobId).maybeSingle(),
    getCanvasDesignForJob(jobId).catch(() => null),
    readJobModel(supabase, jobId),
    supabase.from("job_photos").select("path, zone_id, kind").eq("job_id", jobId).eq("kind", "before").order("created_at", { ascending: true }).limit(12),
  ]);
  if (!job) return null;
  const property = (job as unknown as { property: { address: string | null; lat: number | null; lng: number | null; parcel: unknown } | null }).property;
  const lot = (property?.parcel ?? null) as LotData | null;
  const pin: LngLat | null = property?.lat != null && property?.lng != null ? [property.lng, property.lat] : null;

  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const { areas, unplaced } = areasFromDesign(zones, design);

  // The evaluator's photos of each area first (they say which bed), then the crew's before photos.
  const photos: ModelPhoto[] = [];
  for (const zone of zones) for (const path of zone.service?.photos ?? []) photos.push({ url: canvasImageUrl(path), areaId: zone.id, bucket: "canvas-images", path });
  const before = (jobPhotos ?? []) as { path: string; zone_id: string | null }[];
  if (before.length > 0) {
    const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(before.map((p) => p.path), PHOTO_URL_SECONDS);
    const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const p of before) {
      const url = urlOf.get(p.path);
      if (url) photos.push({ url, areaId: p.zone_id && areas.some((a) => a.id === p.zone_id) ? p.zone_id : null, bucket: "job-photos", path: p.path });
    }
  }

  return {
    jobId,
    address: property?.address ?? job.name,
    pin,
    house: lot?.footprint ?? null,
    defaultTruck: lot?.front ?? (lot?.footprint ? centroidOf(lot.footprint) : pin),
    areas,
    unplacedAreas: unplaced,
    stored: model.stored,
    ready: model.ready,
    photos: photos.slice(0, 24),
  };
}
