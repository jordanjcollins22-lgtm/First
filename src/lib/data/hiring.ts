import { createAdminClient } from "@/lib/supabase/admin";
import { positionFor, type PositionKey } from "@/lib/hiring/positions";
import { isStage, type Stage } from "@/lib/hiring/screening";

/**
 * Hiring, as the pages read it. The public pages have no account, so they
 * read through the service role and only ever by an applicant's own token or
 * a business's id; the review pages check the hiring tab before calling.
 */

/** The business the careers pages are for when the link doesn't say. */
export const DEFAULT_HIRING_ORG = process.env.HIRING_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const APPLICANT_TOKEN = /^[0-9a-f]{24}$/;

export interface CareersOrg {
  id: string;
  name: string;
  phone: string | null;
}

/** The business from ?org= on the link, or ours. Null when the link names nobody. */
export async function careersOrg(orgParam: string | null | undefined): Promise<CareersOrg | null> {
  const id = orgParam && UUID.test(orgParam) ? orgParam : DEFAULT_HIRING_ORG;
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("id, name, business_phone").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as { id: string; name: string; business_phone: string | null };
  return { id: row.id, name: row.name, phone: row.business_phone };
}

export interface ApplicantByToken {
  id: string;
  organizationId: string;
  firstName: string;
  position: PositionKey;
  stage: Stage;
  videoIn: boolean;
}

/** The applicant behind a video link. */
export async function applicantByToken(token: string): Promise<ApplicantByToken | null> {
  if (!APPLICANT_TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_applicants")
    .select("id, organization_id, name, position, stage, video_path, video_link")
    .eq("token", token)
    .maybeSingle();
  if (!data || !positionFor(data.position) || !isStage(data.stage)) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    firstName: data.name.split(/\s+/)[0] ?? data.name,
    position: data.position as PositionKey,
    stage: data.stage,
    videoIn: Boolean(data.video_path || data.video_link),
  };
}

export interface ApplicantRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  zip: string;
  position: PositionKey;
  stage: Stage;
  source: string | null;
  screenReasons: string[];
  rating: number | null;
  createdAt: string;
  videoSubmittedAt: string | null;
  interviewAt: string | null;
}

function toRow(data: {
  id: string;
  name: string;
  email: string;
  phone: string;
  zip: string;
  position: string;
  stage: string;
  source: string | null;
  screen_reasons: string[];
  rating: number | null;
  created_at: string;
  video_submitted_at: string | null;
  interview_at: string | null;
}): ApplicantRow | null {
  if (!positionFor(data.position) || !isStage(data.stage)) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    zip: data.zip,
    position: data.position as PositionKey,
    stage: data.stage,
    source: data.source,
    screenReasons: data.screen_reasons ?? [],
    rating: data.rating,
    createdAt: data.created_at,
    videoSubmittedAt: data.video_submitted_at,
    interviewAt: data.interview_at,
  };
}

const ROW_FIELDS = "id, name, email, phone, zip, position, stage, source, screen_reasons, rating, created_at, video_submitted_at, interview_at";

/** Every application for a business, newest first. */
export async function listApplicants(organizationId: string): Promise<ApplicantRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_applicants")
    .select(ROW_FIELDS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map(toRow).filter((r): r is ApplicantRow => r !== null);
}

export interface ApplicantDetail extends ApplicantRow {
  answers: Record<string, string>;
  reviewNote: string | null;
  videoUrl: string | null;
  videoLink: string | null;
  events: { at: string; kind: string; detail: Record<string, unknown> | null; actorName: string | null }[];
}

/** One application, with its video ready to play and everything that happened to it. */
export async function getApplicant(organizationId: string, id: string): Promise<ApplicantDetail | null> {
  if (!UUID.test(id)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_applicants")
    .select(`${ROW_FIELDS}, answers, review_note, video_path, video_link`)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = toRow(data);
  if (!row) return null;
  const [{ data: signed }, { data: events }] = await Promise.all([
    data.video_path
      ? admin.storage.from("applicant-videos").createSignedUrl(data.video_path, 60 * 60)
      : Promise.resolve({ data: null }),
    admin.from("applicant_events").select("at, kind, detail, actor_name").eq("applicant_id", id).order("at"),
  ]);
  return {
    ...row,
    answers: (data.answers ?? {}) as Record<string, string>,
    reviewNote: data.review_note,
    videoUrl: signed?.signedUrl ?? null,
    videoLink: data.video_link,
    events: (events ?? []).map((e) => ({ at: e.at, kind: e.kind, detail: e.detail, actorName: e.actor_name })),
  };
}
