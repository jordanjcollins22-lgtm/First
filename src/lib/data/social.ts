import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { describeGap, pairPhotos, townFromAddress, type PhotoGap, type PhotoLike } from "@/lib/social-post";

/** Long enough to work through the studio, short enough to expire before it
 * can be passed around. Same reasoning as the job page. */
const URL_TTL_SECONDS = 60 * 60;

export type SocialStatus = "draft" | "approved" | "scheduled" | "posted" | "skipped";

export interface SocialPost {
  id: string;
  jobId: string;
  jobName: string | null;
  town: string | null;
  beforePhotoId: string | null;
  afterPhotoId: string | null;
  zoneName: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  caption: string | null;
  status: SocialStatus;
  scheduledFor: string | null;
  postedAt: string | null;
  channel: string | null;
}

/** A before and an after that nobody has made a post out of yet. */
export interface PostCandidate {
  jobId: string;
  jobName: string;
  town: string | null;
  zoneId: string | null;
  zoneName: string | null;
  beforePhotoId: string;
  afterPhotoId: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  takenAt: string;
}

function publicUrl(path: string | null): string | null {
  if (!path) return null;
  // Not signed: the social bucket is public on purpose. Nothing lands in it
  // that a person has not approved being seen.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/social-posts/${path}`;
}

/** The queue, newest first. */
export async function listSocialPosts(): Promise<SocialPost[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "id, job_id, before_photo_id, after_photo_id, zone_name, image_path, caption, status, scheduled_for, posted_at, channel, jobs(name, properties(address))"
    )
    .order("created_at", { ascending: false });

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as SocialRow[]).map(toPost);
}

/** This job's posts, for the panel on the job page. */
export async function listSocialPostsForJob(jobId: string): Promise<SocialPost[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "id, job_id, before_photo_id, after_photo_id, zone_name, image_path, caption, status, scheduled_for, posted_at, channel, jobs(name, properties(address))"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as SocialRow[]).map(toPost);
}

/** Every time a post is given a slot it has to miss the ones already booked. */
export async function listScheduledTimes(): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("social_posts")
    .select("scheduled_for")
    .in("status", ["scheduled", "posted"])
    .not("scheduled_for", "is", null);

  if (isMissingTable(error) || error) return [];
  return ((data ?? []) as { scheduled_for: string }[]).map((row) => row.scheduled_for);
}

/**
 * Pairs nobody has turned into a post yet.
 *
 * Reads the photographs the crew already took and subtracts what is already
 * in the queue, so the studio is a list of work waiting rather than a list of
 * everything that ever happened.
 */
export async function listPostCandidates(limit = 40): Promise<PostCandidate[]> {
  const supabase = await createClient();

  const { data: photoRows, error } = await supabase
    .from("job_photos")
    .select("id, job_id, path, kind, zone_id, zone_name, created_at, jobs(name, properties(address))")
    .in("kind", ["before", "after"])
    .order("created_at", { ascending: false })
    .limit(600);

  if (isMissingTable(error) || error || !photoRows) return [];

  const rows = photoRows as unknown as {
    id: string;
    job_id: string;
    path: string;
    kind: PhotoLike["kind"];
    zone_id: string | null;
    zone_name: string | null;
    created_at: string;
    jobs: { name: string | null; properties: { address: string | null } | null } | null;
  }[];

  const { data: existing } = await supabase
    .from("social_posts")
    .select("before_photo_id, after_photo_id");

  const used = new Set(
    ((existing ?? []) as { before_photo_id: string | null; after_photo_id: string | null }[]).map(
      (row) => `${row.before_photo_id}:${row.after_photo_id}`
    )
  );

  const byJob = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byJob.get(row.job_id) ?? [];
    list.push(row);
    byJob.set(row.job_id, list);
  }

  const candidates: PostCandidate[] = [];
  for (const [jobId, jobPhotos] of byJob) {
    for (const pair of pairPhotos(jobPhotos)) {
      if (used.has(`${pair.before.id}:${pair.after.id}`)) continue;
      const job = pair.after.jobs;
      candidates.push({
        jobId,
        jobName: job?.name ?? "Job",
        town: townFromAddress(job?.properties?.address),
        zoneId: pair.zoneId,
        zoneName: pair.zoneName,
        beforePhotoId: pair.before.id,
        afterPhotoId: pair.after.id,
        beforeUrl: null,
        afterUrl: null,
        takenAt: pair.after.created_at,
      });
    }
  }

  candidates.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const shortlist = candidates.slice(0, limit);
  if (shortlist.length === 0) return [];

  // One round trip for every URL. A studio of forty pairs would otherwise
  // make eighty calls to draw one page.
  const pathById = new Map(rows.map((row) => [row.id, row.path]));
  const wanted = shortlist.flatMap((c) => [pathById.get(c.beforePhotoId), pathById.get(c.afterPhotoId)]);
  const { data: signed } = await supabase.storage
    .from("job-photos")
    .createSignedUrls(wanted.filter((p): p is string => Boolean(p)), URL_TTL_SECONDS);

  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return shortlist.map((candidate) => ({
    ...candidate,
    beforeUrl: urlByPath.get(pathById.get(candidate.beforePhotoId) ?? "") ?? null,
    afterUrl: urlByPath.get(pathById.get(candidate.afterPhotoId) ?? "") ?? null,
  }));
}

interface SocialRow {
  id: string;
  job_id: string;
  before_photo_id: string | null;
  after_photo_id: string | null;
  zone_name: string | null;
  image_path: string | null;
  caption: string | null;
  status: string;
  scheduled_for: string | null;
  posted_at: string | null;
  channel: string | null;
  jobs: { name: string | null; properties: { address: string | null } | null } | null;
}

function toPost(row: SocialRow): SocialPost {
  return {
    id: row.id,
    jobId: row.job_id,
    jobName: row.jobs?.name ?? null,
    town: townFromAddress(row.jobs?.properties?.address),
    beforePhotoId: row.before_photo_id,
    afterPhotoId: row.after_photo_id,
    zoneName: row.zone_name,
    imagePath: row.image_path,
    imageUrl: publicUrl(row.image_path),
    caption: row.caption,
    status: row.status as SocialStatus,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    channel: row.channel,
  };
}

export interface JobMissingPhotos {
  jobId: string;
  jobName: string;
  town: string | null;
  status: string;
  /** Who is on it, so chasing it is one message rather than a hunt. */
  assignedName: string | null;
  completedAt: string | null;
  gap: PhotoGap;
  gapLabel: string;
  photoCount: number;
}

/**
 * Jobs that have been worked and have no before-and-after to show for it.
 *
 * Only jobs somebody has actually been on: nagging about photographs of work
 * that has not started is how a list becomes wallpaper. And a job counts as
 * done here the moment it has a usable pair, not when it has photographs —
 * twenty shots that never pair produce nothing, and that is the case worth
 * catching, because it is the one that looks finished from the job page.
 */
export async function listJobsMissingBeforeAfter(limit = 60): Promise<JobMissingPhotos[]> {
  const supabase = await createClient();

  const { data: jobRows, error } = await supabase
    .from("jobs")
    .select("id, name, status, completed_at, assigned_to, properties(address), profiles:assigned_to(full_name, email)")
    .in("status", ["in_progress", "completed"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (isMissingTable(error) || error || !jobRows) return [];

  const jobs = jobRows as unknown as {
    id: string;
    name: string | null;
    status: string;
    completed_at: string | null;
    properties: { address: string | null } | null;
    profiles: { full_name: string | null; email: string | null } | null;
  }[];

  if (jobs.length === 0) return [];

  // One round trip for the photos of every job on the list, rather than one
  // per job — this is a page somebody opens to chase people, not a report.
  const { data: photoRows } = await supabase
    .from("job_photos")
    .select("id, job_id, kind, zone_id, zone_name, created_at")
    .in("job_id", jobs.map((job) => job.id));

  const byJob = new Map<string, PhotoLike[]>();
  for (const row of (photoRows ?? []) as unknown as (PhotoLike & { job_id: string })[]) {
    const list = byJob.get(row.job_id) ?? [];
    list.push(row);
    byJob.set(row.job_id, list);
  }

  const missing: JobMissingPhotos[] = [];
  for (const job of jobs) {
    const photos = byJob.get(job.id) ?? [];
    const gap = describeGap(photos);
    if (!gap) continue;

    missing.push({
      jobId: job.id,
      jobName: job.name ?? "Job",
      town: townFromAddress(job.properties?.address),
      status: job.status,
      assignedName: job.profiles?.full_name || job.profiles?.email || null,
      completedAt: job.completed_at,
      gap: gap.code,
      gapLabel: gap.label,
      photoCount: photos.length,
    });
  }

  return missing.slice(0, limit);
}
