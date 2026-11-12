import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getIntegration } from "@/lib/integrations/store";
import { adCopy, zipFromAddress } from "@/lib/marketing/ad-draft";
import { townFromAddress } from "@/lib/social-post";

/**
 * Google ads made from finished-job photos (ad-draft.ts has the rules).
 *
 * Drafts are made once a day, from the Google daily run, for every business
 * with Google Ads connected: each job whose photos the crew finished in the
 * last 30 days and that has an "after" photo, a few at a time. Nothing is
 * sent to Google here; that waits for the owner's Approve.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface AdDraft {
  id: string;
  jobId: string;
  name: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
  zip: string | null;
  /** A short-lived link to the photo, for showing it. */
  photoUrl: string | null;
  createdAt: string;
}

/** Makes up to `max` new drafts. Runs with the service role. */
export async function makeAdDrafts(client: unknown, org: string, now = new Date(), max = 3): Promise<number> {
  const sb = untyped(client);
  const ads = await getIntegration(org, "google_ads");
  if (!ads || ads.status === "not_connected") return 0;

  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, photos_approved_at, properties!inner(address, customers!inner(organization_id))")
    .eq("properties.customers.organization_id", org)
    .gte("photos_approved_at", since)
    .order("photos_approved_at", { ascending: false })
    .limit(30);
  const rows = (jobs ?? []) as unknown as { id: string; properties: { address: string | null } | null }[];
  if (!rows.length) return 0;
  const ids = rows.map((j) => j.id);
  const [{ data: existing }, { data: photos }, { data: orgRow }, { data: requested }] = await Promise.all([
    sb.from("ad_drafts").select("job_id").eq("organization_id", org).in("job_id", ids),
    sb.from("job_photos").select("id, job_id, created_at").in("job_id", ids).eq("kind", "after").order("created_at", { ascending: false }),
    sb.from("organizations").select("name").eq("id", org).maybeSingle(),
    sb.from("job_requested_services").select("job_id, service_type_id").in("job_id", ids),
  ]);
  const drafted = new Set(((existing ?? []) as { job_id: string }[]).map((e) => e.job_id));
  const photoOf = new Map<string, string>();
  for (const p of (photos ?? []) as { id: string; job_id: string }[]) if (!photoOf.has(p.job_id)) photoOf.set(p.job_id, p.id);
  const business = (orgRow as { name?: string | null } | null)?.name || "Local Landscaping";
  const typeIds = [...new Set(((requested ?? []) as { service_type_id: string }[]).map((r) => r.service_type_id))];
  const { data: services } = typeIds.length
    ? await sb.from("services").select("service_type_id, name").eq("organization_id", org).in("service_type_id", typeIds)
    : { data: [] };
  const nameOf = new Map(((services ?? []) as { service_type_id: string; name: string }[]).map((s) => [s.service_type_id, s.name]));

  let made = 0;
  for (const job of rows) {
    if (made >= max) break;
    const photoId = photoOf.get(job.id);
    if (drafted.has(job.id) || !photoId) continue;
    const address = job.properties?.address ?? null;
    const town = townFromAddress(address);
    const servicesFor = ((requested ?? []) as { job_id: string; service_type_id: string }[])
      .filter((r) => r.job_id === job.id)
      .map((r) => nameOf.get(r.service_type_id))
      .filter((n): n is string => Boolean(n));
    const copy = adCopy({ services: servicesFor, town, business });
    const service = servicesFor[0] ?? "Landscaping";
    const { error } = await sb.from("ad_drafts").insert({
      organization_id: org,
      job_id: job.id,
      photo_id: photoId,
      name: `${town ? `${town} ` : ""}${service} ${now.toISOString().slice(0, 10)}`.slice(0, 100),
      headlines: copy.headlines,
      descriptions: copy.descriptions,
      keywords: [...new Set([...servicesFor, "landscaping"].map((s) => (town ? `${s} ${town}` : s).toLowerCase()))].slice(0, 10),
      zip: zipFromAddress(address),
    });
    if (!error) made++;
  }
  return made;
}

/** The drafts waiting for the owner, newest first, with a link to each photo. */
export async function listAdDrafts(): Promise<AdDraft[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("ad_drafts")
    .select("id, job_id, name, headlines, descriptions, keywords, zip, created_at, job_photos(path)")
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  type Row = {
    id: string;
    job_id: string;
    name: string;
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    zip: string | null;
    created_at: string;
    job_photos: { path: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const paths = rows.map((r) => r.job_photos?.path).filter((p): p is string => Boolean(p));
  const { data: signed } = paths.length ? await supabase.storage.from("job-photos").createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    name: r.name,
    headlines: r.headlines,
    descriptions: r.descriptions,
    keywords: r.keywords,
    zip: r.zip,
    photoUrl: r.job_photos?.path ? urlOf.get(r.job_photos.path) ?? null : null,
    createdAt: r.created_at,
  }));
}
