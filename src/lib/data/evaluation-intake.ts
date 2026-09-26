import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cleanAnswers, type IntakeAnswers } from "@/lib/evaluation-intake";

/** One pre-evaluation form, however it was reached. */
export interface Intake {
  id: string;
  jobId: string;
  token: string;
  answers: IntakeAnswers;
  submittedAt: string | null;
  submittedBy: "client" | "together" | null;
  /** The photos they sent, signed for an hour. */
  photoUrls: { path: string; url: string }[];
}

/** What the public page shows around the form. */
export interface PublicIntake extends Intake {
  businessName: string;
  businessPhone: string | null;
  clientFirstName: string | null;
  address: string | null;
  /** The visit, as an instant. */
  evaluationAt: string | null;
  cancelled: boolean;
}

/** An hour: long enough to read the form, short enough not to travel. */
const PHOTO_URL_SECONDS = 60 * 60;

/** Signed links for the photos, in the order they were sent. */
async function signPhotos(
  storage: SupabaseClient["storage"],
  paths: string[]
): Promise<{ path: string; url: string }[]> {
  if (paths.length === 0) return [];
  const { data } = await storage.from("job-photos").createSignedUrls(paths, PHOTO_URL_SECONDS);
  const byPath = new Map((data ?? []).map((s) => [s.path, s.signedUrl]));
  return paths.flatMap((path) => (byPath.get(path) ? [{ path, url: byPath.get(path)! }] : []));
}

/**
 * The form behind a token, for somebody with no account.
 *
 * Service role, because the reader is a client on their own phone. The
 * token is the whole of the authorisation, which is why it is 24 random hex
 * characters and why nothing about the business's other clients is here.
 */
export async function getIntakeByToken(token: string): Promise<PublicIntake | null> {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("evaluation_intakes")
    .select(
      "id, job_id, token, answers, submitted_at, submitted_by, organization:organizations(name, business_phone), job:jobs(evaluation_date, evaluation_status, cancelled_at, property:properties(address, customer:customers(name)))"
    )
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    job_id: string;
    token: string;
    answers: unknown;
    submitted_at: string | null;
    submitted_by: "client" | "together" | null;
    organization: { name: string; business_phone: string | null } | null;
    job: {
      evaluation_date: string | null;
      evaluation_status: string;
      cancelled_at: string | null;
      property: { address: string; customer: { name: string } | null } | null;
    } | null;
  };

  const answers = cleanAnswers(row.answers);
  return {
    id: row.id,
    jobId: row.job_id,
    token: row.token,
    answers,
    photoUrls: await signPhotos(admin.storage, answers.photos),
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    businessName: row.organization?.name ?? "",
    businessPhone: row.organization?.business_phone ?? null,
    clientFirstName: row.job?.property?.customer?.name?.trim().split(/\s+/)[0] ?? null,
    address: row.job?.property?.address ?? null,
    evaluationAt: row.job?.evaluation_date ?? null,
    cancelled: Boolean(row.job?.cancelled_at) || row.job?.evaluation_status === "cancelled",
  };
}

/** The form for a job, for somebody signed in. Null when the job has no evaluation. */
export async function getIntakeForJob(jobId: string): Promise<Intake | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("evaluation_intakes")
    .select("id, job_id, token, answers, submitted_at, submitted_by")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  const answers = cleanAnswers(data.answers);
  return {
    id: data.id,
    jobId: data.job_id,
    token: data.token,
    answers,
    photoUrls: await signPhotos(supabase.storage, answers.photos),
    submittedAt: data.submitted_at,
    submittedBy: (data.submitted_by as Intake["submittedBy"]) ?? null,
  };
}

/** Where the form lives, relative to the app. */
export function intakePath(token: string, together = false): string {
  return together ? `/prep/${token}?together=1` : `/prep/${token}`;
}
