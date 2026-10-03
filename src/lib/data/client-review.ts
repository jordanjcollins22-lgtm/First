import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aftersMissing, beforeAfterPairs, type BeforeAfterPair, type ClientReviewState, type CloseoutInput } from "@/lib/project-closeout";
import { walkthroughGate } from "@/lib/walkthrough";
import type { WorkZone } from "@/components/canvas/types";

const URL_TTL_SECONDS = 60 * 60 * 24 * 7;

type ReviewRow = {
  status: string;
  sent_at: string;
  responded_at: string | null;
  client_note: string | null;
  recorded_by: string | null;
};

export function toReviewState(row: ReviewRow | null): ClientReviewState | null {
  if (!row) return null;
  const status = row.status === "approved" || row.status === "changes" ? row.status : "sent";
  return {
    status,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    clientNote: row.client_note,
    inPerson: Boolean(row.recorded_by),
  };
}

/** The newest time the before and afters went to the client, for the office. */
export async function latestClientReview(jobId: string): Promise<(ClientReviewState & { token: string }) | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_client_reviews")
    .select("token, status, sent_at, responded_at, client_note, recorded_by")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const state = toReviewState(data);
  return state && data ? { ...state, token: data.token } : null;
}

export interface ClientReviewPage {
  token: string;
  businessName: string;
  address: string;
  clientName: string | null;
  pairs: BeforeAfterPair[];
  review: ClientReviewState;
  /** A newer one has gone out since: this link is only a record. */
  superseded: boolean;
}

/**
 * What the client sees from the link: their befores and afters, area by
 * area. Read with the service role, because the client has no account and
 * the token is the whole of their access. Nothing about money is fetched.
 */
export async function clientReviewByToken(token: string): Promise<ClientReviewPage | null> {
  if (!/^[a-f0-9]{16,64}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("job_client_reviews")
    .select("id, job_id, organization_id, token, status, sent_at, responded_at, client_note, recorded_by, created_at")
    .eq("token", token)
    .maybeSingle();
  if (!row) return null;

  const [{ data: job }, { data: org }, { data: design }, { data: photos }, { data: newer }] = await Promise.all([
    admin.from("jobs").select("id, property:properties(address, customers(name))").eq("id", row.job_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle(),
    admin.from("canvas_designs").select("zones").eq("job_id", row.job_id).maybeSingle(),
    admin.from("job_photos").select("path, kind, zone_id, zone_name, created_at").eq("job_id", row.job_id).in("kind", ["before", "after"]),
    admin.from("job_client_reviews").select("id").eq("job_id", row.job_id).gt("created_at", row.created_at).limit(1),
  ]);
  if (!job) return null;

  const rows = (photos ?? []) as { path: string; kind: string; zone_id: string | null; zone_name: string | null; created_at: string }[];
  const { data: signed } = rows.length
    ? await admin.storage.from("job-photos").createSignedUrls(rows.map((p) => p.path), URL_TTL_SECONDS)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const zones = (((design?.zones ?? []) as unknown as WorkZone[]) ?? []).filter((z) => z.service).map((z) => ({ id: z.id, name: z.name }));
  const pairs = beforeAfterPairs(
    rows.map((p) => ({ kind: p.kind, zoneId: p.zone_id, zoneName: p.zone_name, url: urlByPath.get(p.path) ?? null, createdAt: p.created_at })),
    zones
  );

  const property = (job as unknown as { property: { address: string; customers: { name: string | null } | null } | null }).property;
  return {
    token: row.token,
    businessName: org?.name ?? "",
    address: property?.address ?? "",
    clientName: property?.customers?.name ?? null,
    pairs,
    review: toReviewState(row)!,
    superseded: (newer ?? []).length > 0,
  };
}

/**
 * Everything closing a job depends on, read fresh from the database, so the
 * page and the actions judge it the same way and a stale screen cannot
 * approve past something that changed.
 */
export async function closeoutInputFor(jobId: string): Promise<{ input: CloseoutInput; zones: { id: string; name: string }[]; organizationId: string } | null> {
  const supabase = await createClient();
  const [{ data: job }, { data: design }, { data: photos }, { data: waivers }, { data: walks }, { data: marks }, review] = await Promise.all([
    supabase.from("jobs").select("id, status, photos_approved_at, property:properties!inner(customers!inner(organization_id))").eq("id", jobId).maybeSingle(),
    supabase.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_photos").select("kind, zone_id").eq("job_id", jobId),
    supabase.from("job_photo_waivers").select("zone_id, stage").eq("job_id", jobId),
    supabase.from("job_walkthroughs").select("status, requested_at, reviewed_at, review_notes").eq("job_id", jobId).order("requested_at", { ascending: false }),
    supabase.from("job_photo_marks").select("resolved_at").eq("job_id", jobId),
    latestClientReview(jobId),
  ]);
  if (!job) return null;

  const zones = (((design?.zones ?? []) as unknown as WorkZone[]) ?? []).filter((z) => z.service).map((z) => ({ id: z.id, name: z.name }));
  const photoRows = (photos ?? []) as { kind: string; zone_id: string | null }[];
  const waivedAfter = new Set(((waivers ?? []) as { zone_id: string | null; stage: string }[]).filter((w) => w.stage === "after" && w.zone_id).map((w) => w.zone_id!));
  const missing = aftersMissing(photoRows.map((p) => ({ kind: p.kind, zoneId: p.zone_id })), zones, waivedAfter);
  const status = job.status as string;

  return {
    zones,
    organizationId: (job as unknown as { property: { customers: { organization_id: string } } }).property.customers.organization_id,
    input: {
      started: status === "in_progress" || status === "completed" || photoRows.some((p) => p.kind === "during" || p.kind === "after"),
      walkthrough: walkthroughGate((walks ?? []) as Parameters<typeof walkthroughGate>[0]),
      aftersComplete: zones.length > 0 && missing.length === 0,
      aftersMissing: missing,
      review,
      openMarks: ((marks ?? []) as { resolved_at: string | null }[]).filter((m) => !m.resolved_at).length,
      photosApprovedAt: (job.photos_approved_at as string | null) ?? null,
      jobStatus: status,
    },
  };
}
