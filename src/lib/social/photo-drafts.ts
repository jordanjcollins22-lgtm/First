/**
 * Photo to social post draft: the rules, pure.
 *
 * Two ways a photo arrives. Jordan uploads it to the photo backlog on
 * Admin › Social, or the crew finishes a job and its before and after
 * photos are submitted. Either way it becomes a social_posts draft at once:
 * a picture, a caption, the accounts it is for and a suggested time, waiting
 * for Approve or Deny. Nothing here posts anything, and nothing made here
 * is approved: every draft waits for a person.
 *
 * Captions say the town and nothing narrower: no street, no client's name,
 * no price, no licence or insurance claim (checked by planProblems and
 * captionProblems, and anything a person typed is scrubbed first).
 */

import { pairPhotos, suggestCaption, type PhotoLike } from "@/lib/social-post";
import { captionProblems, scrubCaption, type CaptionParts } from "@/lib/social-caption";
import { cleanHashtags, composePlanCaption, planProblems, type CardStyle, type PlanKind, type PlanText } from "@/lib/social-plan";
import { fillSlots, type Booking, type SocialCadence } from "@/lib/social/cadence";

export const DEFAULT_PHONE = "443-819-1521";

/** Where a job draft says it came from, kept on social_posts.auto_source. */
export const CREW_SOURCE = "crew_photos";
/** Where an uploaded photo's draft came from. */
export const BACKLOG_SOURCE = "photo_backlog";

/** How a draft's picture is made: a before and after, one after, or an uploaded photo. */
export type DraftShape = "pair" | "single" | "upload";

export interface DraftInput {
  shape: DraftShape;
  /** Town only. Never an address. */
  town: string | null;
  /** What was done, when known: "Mulching", "Fall cleanup". */
  service?: string | null;
  /** A short note somebody typed with an upload. Kept only if it is safe to post. */
  note?: string | null;
  phone?: string | null;
  /** The booking page, put into the call to action. */
  bookingUrl: string;
  /** Words that must never appear: the client's names and street. */
  privateTerms?: string[];
}

/** One word for a hashtag. */
const tag = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");

/** The note, if it can go into a public caption as typed (after scrubbing). */
export function safeNote(note: string | null | undefined, privateTerms: string[] = []): string | null {
  const line = scrubCaption((note ?? "").replace(/\s+/g, " ").trim(), privateTerms).slice(0, 280).trim();
  if (!line) return null;
  if (captionProblems(line, privateTerms).length) return null;
  if (planProblems({ hook: "x", body: line, cta: "x", hashtags: ["a", "b", "c"] }).length) return null;
  return line;
}

/**
 * The template caption for a draft, in the week plan's four parts. The
 * first line of the body is suggestCaption's, the same words the studio
 * has always started from.
 */
export function draftText(input: DraftInput): PlanText {
  const terms = input.privateTerms ?? [];
  const town = input.town?.trim() || null;
  const service = input.service?.trim() || null;
  const phone = input.phone?.trim() || DEFAULT_PHONE;
  const where = town ?? "Harford County";

  const hook =
    input.shape === "pair"
      ? `Before and after in ${where}.`
      : service
        ? `Fresh ${service.toLowerCase()} in ${where}.`
        : `Fresh work from the crew in ${where}.`;

  const opener = suggestCaption({ services: service ? [service] : [], city: town, phone }).split("\n")[0];
  const first = input.shape === "pair" ? opener : opener.replace(/ Swipe for the before\.$/, ".");
  const note = safeNote(input.note, terms);
  const body = [first, note].filter(Boolean).join(" ");

  const cta = `Free estimates: call or text ${phone}, or book here: ${input.bookingUrl}`;
  const hashtags = cleanHashtags([
    ...(service ? [tag(service)] : []),
    ...(input.shape === "pair" ? ["BeforeAndAfter"] : []),
    ...(town ? [tag(town)] : []),
    "HarfordCounty",
    "Landscaping",
    "JSLandscaping",
  ]);
  return scrubText({ hook, body, cta, hashtags }, terms);
}

/** The AI writer's four parts as the week plan's: the SEO line's hashtags become the hashtags. */
export function partsToPlanText(parts: CaptionParts, privateTerms: string[] = []): PlanText {
  const tags = parts.seo.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seoLine = parts.seo.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  return scrubText(
    {
      hook: parts.hook.trim(),
      body: [parts.meat.trim(), seoLine].filter(Boolean).join("\n\n"),
      cta: parts.cta.trim(),
      hashtags: cleanHashtags(tags),
    },
    privateTerms
  );
}

function scrubText(t: PlanText, terms: string[]): PlanText {
  return { hook: scrubCaption(t.hook, terms), body: scrubCaption(t.body, terms), cta: scrubCaption(t.cta, terms), hashtags: t.hashtags };
}

/** Everything that would stop a draft's caption going out as written. */
export function draftProblems(t: PlanText, privateTerms: string[] = []): string[] {
  return [...new Set([...planProblems(t), ...captionProblems(composePlanCaption(t, null), privateTerms)])];
}

/** The caption as it will be posted. */
export function draftCaption(t: PlanText): string {
  return composePlanCaption(t, null);
}

// ------------------------------------------------------------
// Which photos
// ------------------------------------------------------------

export type ChosenPhotos<T extends PhotoLike> =
  | { shape: "pair"; before: T; after: T; zoneId: string | null; zoneName: string | null }
  | { shape: "single"; after: T; zoneId: string | null; zoneName: string | null };

/**
 * The picture for a finished job: its first before and after of the same
 * area when there is one, otherwise its best after photo on its own (the
 * last one taken: the crew's final look at the finished work).
 */
export function choosePhotos<T extends PhotoLike>(photos: T[]): ChosenPhotos<T> | null {
  const pair = pairPhotos(photos)[0];
  if (pair) return { shape: "pair", before: pair.before, after: pair.after, zoneId: pair.zoneId, zoneName: pair.zoneName };
  const afters = photos.filter((p) => p.kind === "after").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const best = afters[0];
  if (!best) return null;
  return { shape: "single", after: best, zoneId: best.zone_id, zoneName: best.zone_name };
}

// ------------------------------------------------------------
// When
// ------------------------------------------------------------

/**
 * The suggested time for a new draft: the next free cadence slot, missing
 * everything already booked or suggested. Kept when it is approved while
 * still ahead.
 */
export function suggestSlot(cadence: SocialCadence, booked: readonly Booking[], now: Date, platforms: readonly string[] = ["facebook", "instagram"]): Date | null {
  const [fit] = fillSlots({ cadence, waiting: [{ id: "new", platforms }], booked, now, weeks: 8 });
  return fit ? new Date(fit.scheduledFor) : null;
}

/**
 * The time an approved draft goes out: its suggested time while that is
 * still ahead and clear of everything else on its accounts, otherwise the
 * next free slot.
 */
export function approvalSlot(input: {
  cadence: SocialCadence;
  suggested: string | null;
  booked: readonly Booking[];
  platforms: readonly string[];
  now: Date;
  minGapHours?: number;
}): Date | null {
  const gap = (input.minGapHours ?? 12) * 3_600_000;
  if (input.suggested) {
    const at = new Date(input.suggested);
    const t = at.getTime();
    const clear = input.booked.every((b) => {
      const shares = b.platforms.some((p) => input.platforms.includes(p));
      return !shares || Math.abs(new Date(b.at).getTime() - t) >= gap;
    });
    if (t > input.now.getTime() + 30 * 60_000 && clear) return at;
  }
  return suggestSlot(input.cadence, input.booked, input.now, input.platforms);
}

// ------------------------------------------------------------
// The row
// ------------------------------------------------------------

export interface DraftRowInput {
  organizationId: string;
  text: PlanText;
  slot: Date | null;
  /** Local day (YYYY-MM-DD) of the slot, or today when there is none. */
  planDay: string;
  jobId?: string | null;
  beforePhotoId?: string | null;
  afterPhotoId?: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
  backlogPhotoId?: string | null;
  source: typeof CREW_SOURCE | typeof BACKLOG_SOURCE;
  shape: DraftShape;
  now: Date;
}

/**
 * The social_posts row for a new draft: status 'draft', never approved, its
 * suggested time on it. It shows in "Ready to approve" on Admin › Social
 * and in the week plan.
 */
export function draftRow(input: DraftRowInput): Record<string, unknown> {
  const kind: PlanKind = input.shape === "pair" ? "before-after" : "local";
  const cardStyle: CardStyle = input.shape === "pair" ? "split" : "photo";
  return {
    organization_id: input.organizationId,
    job_id: input.jobId ?? null,
    before_photo_id: input.beforePhotoId ?? null,
    after_photo_id: input.afterPhotoId ?? null,
    zone_id: input.zoneId ?? null,
    zone_name: input.zoneName ?? null,
    ...(input.backlogPhotoId ? { backlog_photo_id: input.backlogPhotoId } : {}),
    kind,
    card_style: cardStyle,
    hook: input.text.hook,
    body: input.text.body,
    cta: input.text.cta,
    hashtags: input.text.hashtags,
    caption: draftCaption(input.text),
    plan_day: input.planDay,
    placement: "page",
    status: "draft",
    scheduled_for: input.slot ? input.slot.toISOString() : null,
    approved_at: null,
    approved_by: null,
    auto_source: input.source,
    updated_at: input.now.toISOString(),
  };
}

/** What the queue says a draft came from. */
export function sourceLabel(post: { backlogPhotoId?: string | null; autoSource?: string | null; jobNumber?: number | null; jobId?: string | null; seedKey?: string | null }): string {
  if (post.backlogPhotoId || post.autoSource === BACKLOG_SOURCE) return "Uploaded";
  if (post.seedKey) return "Starter post";
  if (post.jobId) return post.jobNumber != null ? `From job #${post.jobNumber}` : "From a job";
  return "Planned";
}
