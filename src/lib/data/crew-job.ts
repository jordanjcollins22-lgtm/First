import { hazardLines, pickVisit } from "@/lib/crew-route";
import { readCrewMap, type CrewMap } from "@/lib/crew-map-areas";
import { addonLines, readAddons } from "@/lib/proposal-addons";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateKeyIn } from "@/lib/time-zone";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

export interface CrewZone {
  zoneName: string;
  serviceLabel: string;
  scopeText: string;
  /** What to do and what to bring, from the proposal's own lines. Never prices. */
  details: string[];
  photoPaths: string[];
  /** Where the evaluator tapped each photo (0 to 1 across and down), keyed by photo path: which bush, which plant. */
  photoTaps: Record<string, { x: number; y: number }[]>;
  points: { x: number; y: number }[];
  shapes?: { x: number; y: number }[][];
  color: string;
}

export interface CrewJob {
  jobId: string;
  title: string;
  clientName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  status: string;
  notes: string | null;
  zones: CrewZone[];
  siteImagePath: string | null;
  siteImageTransform: ProposalSiteImageTransform | null;
  /** The visit the crew is on (today's, else the next one): what's left to do there. */
  leftToDo: string | null;
  visitDay: string | null;
  /** Warnings picked out of what's left and the project notes. */
  hazards: string[];
  /** The parts of the lot the crew works, when no site map was drawn. */
  crewMap: CrewMap | null;
}


type Line = { note?: string | null };

/**
 * One job as the crew sees it: where, what, the map and the photos.
 *
 * Read with the service key, because the person opening it has no login, so
 * this picks its fields by hand and leaves out everything about money: no
 * totals, no area prices, no invoices, no phone or email. The scope comes from
 * the signed proposal where there is one, else the latest proposal.
 */
type ProposalRow = { status: string | null; scope_snapshot: unknown };
const chosenOf = <T extends ProposalRow>(list: T[] | null) => (list ?? []).find((p) => p.status === "accepted") ?? (list ?? [])[0] ?? null;

/**
 * Which of these photo paths are really in storage. A path whose file is gone
 * would show the crew a broken picture, so it is left out. Listed folder by
 * folder (one call per job folder); a path that starts with a slash ships with
 * the site and is kept. If storage can't be read, every path is kept and the
 * page hides any that fail to load.
 */
async function storedPhotos(admin: ReturnType<typeof createAdminClient>, paths: string[]): Promise<Set<string>> {
  const keep = new Set(paths.filter((p) => p.startsWith("/")));
  const dirs = new Map<string, string[]>();
  for (const p of paths) {
    if (p.startsWith("/")) continue;
    const cut = p.lastIndexOf("/");
    const dir = cut < 0 ? "" : p.slice(0, cut);
    dirs.set(dir, [...(dirs.get(dir) ?? []), p]);
  }
  for (const [dir, list] of dirs) {
    const { data, error } = await admin.storage.from("canvas-images").list(dir, { limit: 1000 });
    if (error || !data) {
      list.forEach((p) => keep.add(p));
      continue;
    }
    const names = new Set(data.map((f) => f.name));
    for (const p of list) if (names.has(p.slice(dir.length ? dir.length + 1 : 0))) keep.add(p);
  }
  return keep;
}

export async function loadCrewJob(jobId: string): Promise<CrewJob | null> {
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id, name, status, client_notes, properties(address, lat, lng, customers(name))")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const { data: proposals } = await admin
    .from("job_proposals")
    .select("status, scope_snapshot, site_image_path, site_image_transform, created_at, options")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  const { data: visits } = await admin
    .from("job_work_sessions")
    .select("starts_on, ends_on, purpose")
    .eq("job_id", jobId)
    .is("subcontractor_id", null)
    .not("status", "in", "(cancelled,done)")
    .order("starts_on", { ascending: true });
  const visit = pickVisit((visits ?? []) as { starts_on: string; ends_on: string; purpose: string | null }[], dateKeyIn(new Date()));

  const taps = await loadPhotoTaps(jobId);
  const stored = await storedPhotos(admin, (Array.isArray(chosenOf(proposals)?.scope_snapshot) ? (chosenOf(proposals)!.scope_snapshot as { photoPaths?: string[] }[]) : []).flatMap((z) => z.photoPaths ?? []));
  const real = (paths: string[] | undefined) => (paths ?? []).filter((p) => stored.has(p));

  const list = proposals ?? [];
  const chosen = list.find((p) => p.status === "accepted") ?? list[0] ?? null;

  const place = (job as unknown as { properties: { address: string; lat: number | null; lng: number | null; customers: { name: string } | null } | null }).properties;
  const snapshot = (Array.isArray(chosen?.scope_snapshot) ? chosen?.scope_snapshot : []) as unknown as (ProposalZoneSnapshot & { lines?: Line[] })[];

  return {
    jobId,
    title: cleanTitle(job.name ?? "", place?.address ?? ""),
    clientName: place?.customers?.name ?? "",
    address: place?.address ?? "",
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    status: job.status ?? "",
    notes: job.client_notes ?? null,
    leftToDo: visit?.purpose?.trim() || null,
    visitDay: visit?.starts_on ?? null,
    hazards: hazardLines(visit?.purpose, job.client_notes),
    crewMap: readCrewMap(chosen?.options),
    zones: [...snapshot.map((z) => ({
      zoneName: z.zoneName,
      serviceLabel: z.serviceLabel,
      scopeText: z.scopeText,
      details: (z.lines ?? []).map((l) => (l.note ?? "").trim()).filter(Boolean),
      photoPaths: real(z.photoPaths),
      photoTaps: tapsFor(real(z.photoPaths), taps),
      points: z.points ?? [],
      shapes: z.shapes,
      color: z.color,
    })),
    // Add-ons the client ticked when they signed (Christmas lights, say), so
    // the crew sees them as part of the job. No outline: they are not an area.
    ...(chosen?.status === "accepted" ? readAddons(chosen.options).filter((a) => a.chosen) : []).map((a) => ({
      zoneName: a.name,
      serviceLabel: a.name,
      scopeText: addonLines(a).join("\n"),
      details: [] as string[],
      photoPaths: [] as string[],
      photoTaps: {},
      points: [] as { x: number; y: number }[],
      shapes: undefined,
      color: "#c0392b",
    }))],
    siteImagePath: chosen?.site_image_path ?? null,
    siteImageTransform: (chosen?.site_image_transform as unknown as ProposalSiteImageTransform | null) ?? null,
  };
}

/** "1792 Cosner Road, Forest Hill, ..., Retaining wall repair" reads as "Retaining wall repair". */
export function cleanTitle(name: string, address: string): string {
  let title = name.trim();
  if (address && title.startsWith(address)) title = title.slice(address.length);
  else {
    const street = address.split(",")[0];
    if (street && title.startsWith(street)) title = title.replace(/^[^,]*(,[^,]*)?,\s*/, "");
  }
  title = title.replace(/^[\s,—-]+/, "").trim();
  return title || "Project";
}

type Tap = { x: number; y: number };

/**
 * The taps the evaluator put on the zone photos, by photo path. They live on
 * the site plan (canvas_designs), not the proposal snapshot, so they are read
 * from there; a photo is the same file in both.
 */
async function loadPhotoTaps(jobId: string): Promise<Map<string, Tap[]>> {
  const admin = createAdminClient();
  const { data } = await admin.from("canvas_designs").select("zones").eq("job_id", jobId).limit(1).maybeSingle();
  return readPhotoTaps(data?.zones);
}

export function readPhotoTaps(zones: unknown): Map<string, Tap[]> {
  const out = new Map<string, Tap[]>();
  if (!Array.isArray(zones)) return out;
  for (const zone of zones) {
    const markers = (zone as { service?: { photoMarkers?: unknown } } | null)?.service?.photoMarkers;
    if (!markers || typeof markers !== "object") continue;
    for (const [path, points] of Object.entries(markers as Record<string, unknown>)) {
      if (!Array.isArray(points)) continue;
      const good = points.filter(
        (p): p is Tap =>
          !!p && typeof (p as Tap).x === "number" && typeof (p as Tap).y === "number" && (p as Tap).x >= 0 && (p as Tap).x <= 1 && (p as Tap).y >= 0 && (p as Tap).y <= 1
      );
      if (good.length) out.set(path, good);
    }
  }
  return out;
}

export function tapsFor(paths: string[], taps: Map<string, Tap[]>): Record<string, Tap[]> {
  const out: Record<string, Tap[]> = {};
  for (const path of paths) {
    const t = taps.get(path);
    if (t) out[path] = t;
  }
  return out;
}
