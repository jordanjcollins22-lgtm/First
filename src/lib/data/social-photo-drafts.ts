import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingColumn } from "@/lib/setup-errors";
import { localDay } from "@/lib/marketing/social-autopost";
import { townFromAddress, type PhotoKind } from "@/lib/social-post";
import { areaFromAddress, privateTermsFor } from "@/lib/social-caption";
import { tidyCadence, type Booking, type SocialCadence } from "@/lib/social/cadence";
import { loadCadence } from "@/lib/data/social-autopost";
import {
  BACKLOG_SOURCE,
  CREW_SOURCE,
  DEFAULT_PHONE,
  choosePhotos,
  draftCaption,
  draftProblems,
  draftRow,
  draftText,
  safeNote,
  sourceLabel,
  suggestSlot,
} from "@/lib/social/photo-drafts";
import type { DraftWriter } from "@/lib/social/photo-post-writer";
import type { PlanText } from "@/lib/social-plan";

/**
 * Photos into social post drafts, against the database. The rules are in
 * lib/social/photo-drafts.ts; this reads what they need and writes the
 * draft. Takes any client: the signed-in session from Admin › Social, the
 * service role from the crew's actions and the posting cron.
 *
 * Every draft made here is status 'draft' and waits for Approve or Deny.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface DraftOptions {
  now?: Date;
  /** The booking page, for the call to action. */
  bookingUrl: string;
  /** The AI writer; left out (or null back from it) means the template. */
  writer?: DraftWriter | null;
  /** Read once per run by the caller that makes several. */
  cadence?: SocialCadence;
}

interface OrgFacts {
  name: string;
  phone: string;
}

async function orgFacts(sb: SupabaseClient, org: string): Promise<OrgFacts> {
  const { data } = await sb.from("organizations").select("name, business_phone").eq("id", org).maybeSingle();
  const row = data as { name?: string | null; business_phone?: string | null } | null;
  return { name: row?.name ?? "JS Landscaping", phone: row?.business_phone?.trim() || DEFAULT_PHONE };
}

/**
 * What a new draft's suggested time has to miss: everything scheduled,
 * posted, approved or already suggested on another draft.
 */
export async function loadBookings(
  client: unknown,
  org: string,
  now: Date,
  excludeId?: string,
  statuses: readonly string[] = ["draft", "approved", "scheduled", "posted"]
): Promise<Booking[]> {
  const sb = untyped(client);
  const query = (cols: string) =>
    sb
      .from("social_posts")
      .select(cols)
      .eq("organization_id", org)
      .eq("placement", "page")
      .in("status", [...statuses])
      .not("scheduled_for", "is", null)
      .gte("scheduled_for", new Date(now.getTime() - 7 * 86_400_000).toISOString())
      .limit(500);
  let { data, error } = await query("id, scheduled_for, platforms");
  if (isMissingColumn(error)) ({ data, error } = await query("id, scheduled_for"));
  if (error) return [];
  return ((data ?? []) as unknown as { id: string; scheduled_for: string | null; platforms?: string[] | null }[])
    .filter((r) => r.id !== excludeId && r.scheduled_for)
    .map((r) => ({ at: r.scheduled_for as string, platforms: r.platforms ?? ["facebook", "instagram"] }));
}

async function cadenceFor(sb: SupabaseClient, org: string, given?: SocialCadence): Promise<SocialCadence> {
  if (given) return given;
  const row = await loadCadence(sb, org).catch(() => null);
  return row?.cadence ?? tidyCadence(null);
}

async function slotFor(sb: SupabaseClient, org: string, now: Date, cadence: SocialCadence): Promise<{ slot: Date | null; planDay: string }> {
  const slot = suggestSlot(cadence, await loadBookings(sb, org, now), now);
  return { slot, planDay: localDay(slot ?? now) };
}

// ------------------------------------------------------------
// From a finished job
// ------------------------------------------------------------

export type JobDraftResult = { made: true; postId: string | null; shape: "pair" | "single" } | { made: false; reason: string };

interface JobRow {
  id: string;
  job_number: number | null;
  properties: { address: string | null; customers: { organization_id: string; name: string | null } | null } | null;
}

/**
 * One draft from a finished job's crew photos: its before and after when
 * it has a pair, otherwise its best after photo alone. Once per job: a job
 * that already has any post (made here, by the autopilot, or by hand in the
 * studio) is left alone, and the database's one-per-job index stops a race.
 */
export async function makeJobDraft(client: unknown, org: string, jobId: string, options: DraftOptions): Promise<JobDraftResult> {
  const sb = untyped(client);
  const now = options.now ?? new Date();

  const { data: jobData } = await sb
    .from("jobs")
    .select("id, job_number, properties!inner(address, customers!inner(organization_id, name))")
    .eq("id", jobId)
    .eq("properties.customers.organization_id", org)
    .maybeSingle();
  const job = jobData as unknown as JobRow | null;
  if (!job || job.properties?.customers?.organization_id !== org) return { made: false, reason: "Not this business's job." };

  const [{ data: existing }, { data: photoRows }, { data: requested }] = await Promise.all([
    sb.from("social_posts").select("id").eq("job_id", jobId).limit(1),
    sb.from("job_photos").select("id, job_id, kind, zone_id, zone_name, created_at").eq("job_id", jobId).in("kind", ["before", "after"]),
    sb.from("job_requested_services").select("job_id, service_type_id").eq("job_id", jobId),
  ]);
  if ((existing ?? []).length > 0) return { made: false, reason: "This job already has a post." };

  const photos = ((photoRows ?? []) as { id: string; job_id: string; kind: PhotoKind; zone_id: string | null; zone_name: string | null; created_at: string }[]).filter(
    (p) => p.job_id === jobId
  );
  const chosen = choosePhotos(photos);
  if (!chosen) return { made: false, reason: "No after photo yet." };

  const typeIds = [...new Set(((requested ?? []) as { job_id: string; service_type_id: string }[]).filter((r) => r.job_id === jobId).map((r) => r.service_type_id))];
  const { data: services } = typeIds.length
    ? await sb.from("services").select("service_type_id, name").eq("organization_id", org).in("service_type_id", typeIds)
    : { data: [] };
  const service = ((services ?? []) as { name: string }[])[0]?.name ?? null;

  const address = job.properties?.address ?? null;
  const town = townFromAddress(address);
  const privateTerms = privateTermsFor(job.properties?.customers?.name, address);
  const facts = await orgFacts(sb, org);
  const text = await writeText(options, {
    shape: chosen.shape,
    town,
    service,
    note: null,
    phone: facts.phone,
    bookingUrl: options.bookingUrl,
    privateTerms,
    businessName: facts.name,
    area: areaFromAddress(address),
    details: chosen.zoneName ? [`area: ${chosen.zoneName}`] : [],
  });

  const cadence = await cadenceFor(sb, org, options.cadence);
  const { slot, planDay } = await slotFor(sb, org, now, cadence);
  const row = draftRow({
    organizationId: org,
    text,
    slot,
    planDay,
    jobId,
    beforePhotoId: chosen.shape === "pair" ? chosen.before.id : null,
    afterPhotoId: chosen.after.id,
    zoneId: chosen.zoneId,
    zoneName: chosen.zoneName,
    source: CREW_SOURCE,
    shape: chosen.shape,
    now,
  });
  let { data: inserted, error } = await sb.from("social_posts").insert(row).select("id").maybeSingle();
  if (isMissingColumn(error)) {
    // Before 0362 there is no auto_source; the draft is the same without it.
    const { auto_source: _source, ...plain } = row;
    void _source;
    ({ data: inserted, error } = await sb.from("social_posts").insert(plain).select("id").maybeSingle());
  }
  if (error) return { made: false, reason: error.code === "23505" ? "This job already has a post." : error.message };
  return { made: true, postId: (inserted as { id: string } | null)?.id ?? null, shape: chosen.shape };
}

async function writeText(
  options: DraftOptions,
  input: {
    shape: "pair" | "single" | "upload";
    town: string | null;
    service: string | null;
    note: string | null;
    phone: string;
    bookingUrl: string;
    privateTerms: string[];
    businessName: string;
    area: ReturnType<typeof areaFromAddress>;
    details: string[];
  }
): Promise<PlanText> {
  const template = draftText(input);
  if (!options.writer) return template;
  const note = safeNote(input.note, input.privateTerms);
  const written = await options
    .writer({
      businessName: input.businessName,
      service: input.service || "Landscaping",
      details: [...input.details, ...(note ? [`note: ${note}`] : [])],
      area: input.area,
      phone: input.phone,
      bookingUrl: input.bookingUrl,
      privateTerms: input.privateTerms,
    })
    .catch(() => null);
  if (!written || draftProblems(written, input.privateTerms).length) return template;
  return written;
}

/**
 * The catch-up, run by the posting cron: finished jobs from the last three
 * weeks (completed, or photos signed off) with no post yet each get their
 * draft. A few a run, so a first run doesn't bury the queue.
 */
export async function catchUpJobDrafts(client: unknown, org: string, options: DraftOptions & { limit?: number; days?: number }): Promise<number> {
  const sb = untyped(client);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? 21) * 86_400_000).toISOString();
  const base = () =>
    sb
      .from("jobs")
      .select("id, completed_at, photos_approved_at, properties!inner(customers!inner(organization_id))")
      .eq("properties.customers.organization_id", org)
      .limit(40);
  const [{ data: completed }, { data: signedOff }] = await Promise.all([
    base().eq("status", "completed").gte("completed_at", since).order("completed_at", { ascending: false }),
    base().not("photos_approved_at", "is", null).gte("photos_approved_at", since).order("photos_approved_at", { ascending: false }),
  ]);
  const ids = [...new Set([...((completed ?? []) as { id: string }[]), ...((signedOff ?? []) as { id: string }[])].map((j) => j.id))];
  if (!ids.length) return 0;

  const { data: existing } = await sb.from("social_posts").select("job_id").in("job_id", ids);
  const hasPost = new Set(((existing ?? []) as { job_id: string | null }[]).map((r) => r.job_id));
  const cadence = await cadenceFor(sb, org, options.cadence);

  let made = 0;
  for (const id of ids) {
    if (made >= (options.limit ?? 5)) break;
    if (hasPost.has(id)) continue;
    const result = await makeJobDraft(sb, org, id, { ...options, cadence, now });
    if (result.made) made++;
    hasPost.add(id);
  }
  return made;
}

// ------------------------------------------------------------
// From the photo backlog
// ------------------------------------------------------------

export interface BacklogPhoto {
  id: string;
  town: string | null;
  service: string | null;
  note: string | null;
}

/** One draft from a photo Jordan uploaded to the backlog. */
export async function makeBacklogDraft(client: unknown, org: string, photo: BacklogPhoto, options: DraftOptions): Promise<{ postId: string } | { error: string }> {
  const sb = untyped(client);
  const now = options.now ?? new Date();
  const town = photo.town?.trim() || null;
  const facts = await orgFacts(sb, org);
  const text = await writeText(options, {
    shape: "upload",
    town,
    service: photo.service?.trim() || null,
    note: photo.note,
    phone: facts.phone,
    bookingUrl: options.bookingUrl,
    privateTerms: [],
    businessName: facts.name,
    area: town ? { town, state: "MD", zip: null } : null,
    details: [],
  });
  const cadence = await cadenceFor(sb, org, options.cadence);
  const { slot, planDay } = await slotFor(sb, org, now, cadence);
  const row = draftRow({ organizationId: org, text, slot, planDay, backlogPhotoId: photo.id, source: BACKLOG_SOURCE, shape: "upload", now });
  const { data, error } = await sb.from("social_posts").insert(row).select("id").maybeSingle();
  if (error || !data) return { error: error?.message ?? "Couldn't make the draft." };
  const postId = (data as { id: string }).id;
  await sb.from("social_photo_backlog").update({ social_post_id: postId, updated_at: now.toISOString() }).eq("id", photo.id);
  return { postId };
}

// ------------------------------------------------------------
// The queue
// ------------------------------------------------------------

export interface QueueItem {
  id: string;
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  caption: string;
  platforms: string[];
  suggestedFor: string | null;
  source: string;
  imageUrl: string;
  photoHint: string | null;
}

/** Every draft waiting for Approve or Deny, newest first. */
export async function listReadyToApprove(client: unknown, org: string, limit = 60): Promise<QueueItem[]> {
  const sb = untyped(client);
  const base = "id, hook, body, cta, hashtags, caption, scheduled_for, job_id, auto_source, updated_at, jobs(job_number)";
  const query = (cols: string) =>
    sb
      .from("social_posts")
      .select(cols)
      .eq("organization_id", org)
      .eq("status", "draft")
      .eq("placement", "page")
      .not("plan_day", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
  let { data, error } = await query(`${base}, platforms, seed_key, photo_hint, backlog_photo_id`);
  if (isMissingColumn(error)) ({ data, error } = await query(`${base}, platforms, seed_key, photo_hint`));
  if (isMissingColumn(error)) ({ data, error } = await query(base));
  if (error) throw error;
  type Row = {
    id: string;
    hook: string | null;
    body: string | null;
    cta: string | null;
    hashtags: string[] | null;
    caption: string | null;
    scheduled_for: string | null;
    job_id: string | null;
    auto_source: string | null;
    updated_at: string;
    platforms?: string[] | null;
    seed_key?: string | null;
    photo_hint?: string | null;
    backlog_photo_id?: string | null;
    jobs: { job_number: number | null } | { job_number: number | null }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    const text = { hook: r.hook ?? "", body: r.body ?? "", cta: r.cta ?? "", hashtags: r.hashtags ?? [] };
    return {
      id: r.id,
      ...text,
      caption: draftCaption(text),
      platforms: r.platforms?.length ? r.platforms : ["facebook", "instagram"],
      suggestedFor: r.scheduled_for,
      source: sourceLabel({ backlogPhotoId: r.backlog_photo_id, autoSource: r.auto_source, jobId: r.job_id, jobNumber: job?.job_number ?? null, seedKey: r.seed_key }),
      imageUrl: `/api/social/card/${r.id}?v=${encodeURIComponent(r.updated_at)}`,
      photoHint: r.photo_hint ?? null,
    };
  });
}

/** How many photos are in the backlog, and how many are already drafts. Null when 0376 isn't applied. */
export async function backlogCounts(client: unknown, org: string): Promise<{ total: number; drafted: number } | null> {
  const sb = untyped(client);
  const { count, error } = await sb.from("social_photo_backlog").select("id", { count: "exact", head: true }).eq("organization_id", org);
  if (error) return null;
  const { count: drafted } = await sb
    .from("social_photo_backlog")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org)
    .not("social_post_id", "is", null);
  return { total: count ?? 0, drafted: drafted ?? 0 };
}

export interface JobCandidate {
  jobId: string;
  jobNumber: number | null;
  town: string | null;
  shape: "pair" | "single" | null;
}

/**
 * Read only: finished jobs from the last three weeks with no post yet, and
 * what the catch-up would make of each (a pair, one after photo, or nothing
 * until an after photo is in). For the review page.
 */
export async function listJobDraftCandidates(client: unknown, org: string, now = new Date(), days = 21): Promise<JobCandidate[]> {
  const sb = untyped(client);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { data: jobs, error } = await sb
    .from("jobs")
    .select("id, job_number, completed_at, properties!inner(address, customers!inner(organization_id))")
    .eq("properties.customers.organization_id", org)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  const rows = (jobs ?? []) as unknown as { id: string; job_number: number | null; properties: { address: string | null } | null }[];
  if (!rows.length) return [];
  const ids = rows.map((j) => j.id);
  const [{ data: existing }, { data: photos }] = await Promise.all([
    sb.from("social_posts").select("job_id").in("job_id", ids),
    sb.from("job_photos").select("id, job_id, kind, zone_id, zone_name, created_at").in("job_id", ids).in("kind", ["before", "after"]),
  ]);
  const hasPost = new Set(((existing ?? []) as { job_id: string | null }[]).map((r) => r.job_id));
  const all = (photos ?? []) as { id: string; job_id: string; kind: PhotoKind; zone_id: string | null; zone_name: string | null; created_at: string }[];
  return rows
    .filter((j) => !hasPost.has(j.id))
    .map((j) => ({
      jobId: j.id,
      jobNumber: j.job_number,
      town: townFromAddress(j.properties?.address ?? null),
      shape: choosePhotos(all.filter((p) => p.job_id === j.id))?.shape ?? null,
    }));
}
