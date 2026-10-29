import { readStoredSpots, type PreEvalSpot } from "@/lib/pre-eval";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface PreEvalSummary {
  id: string;
  spots: PreEvalSpot[];
  submittedAt: string | null;
}

export interface ClientPreEval extends PreEvalSummary {
  address: string;
  lat: number;
  lng: number;
}

export interface PreEvalService {
  id: string;
  name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For the estimator's job workspace. Null until a link has been made. */
export async function getPreEvalForJob(jobId: string): Promise<PreEvalSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pre_evals")
    .select("id, spots, submitted_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, spots: readStoredSpots(data.spots), submittedAt: data.submitted_at };
}

/**
 * For the public page. The client has no session, so this reads through the
 * service-role key and only ever returns what the page shows.
 */
export async function getPreEvalForClient(id: string): Promise<ClientPreEval | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pre_evals")
    .select("id, spots, submitted_at, job:jobs(property:properties(address, lat, lng))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const property = (data.job as unknown as { property: { address: string; lat: number; lng: number } })
    .property;
  return {
    id: data.id,
    spots: readStoredSpots(data.spots),
    submittedAt: data.submitted_at,
    address: property.address,
    lat: property.lat,
    lng: property.lng,
  };
}

/** The services a client can pick from: every active service template. */
export async function listPreEvalServices(): Promise<PreEvalService[]> {
  const { data, error } = await createAdminClient()
    .from("service_templates")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
