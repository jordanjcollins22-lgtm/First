import { createAdminClient } from "@/lib/supabase/admin";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

export interface CrewZone {
  zoneName: string;
  serviceLabel: string;
  scopeText: string;
  /** What to do and what to bring, from the proposal's own lines. Never prices. */
  details: string[];
  photoPaths: string[];
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
    .select("status, scope_snapshot, site_image_path, site_image_transform, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
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
    zones: snapshot.map((z) => ({
      zoneName: z.zoneName,
      serviceLabel: z.serviceLabel,
      scopeText: z.scopeText,
      details: (z.lines ?? []).map((l) => (l.note ?? "").trim()).filter(Boolean),
      photoPaths: z.photoPaths ?? [],
      points: z.points ?? [],
      shapes: z.shapes,
      color: z.color,
    })),
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
