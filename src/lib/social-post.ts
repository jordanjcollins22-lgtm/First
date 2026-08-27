/**
 * Turning finished jobs into posts.
 *
 * The photographs already exist: the crew shoots a before and an after of
 * every zone because the job cannot be signed off without them. Nobody ever
 * does anything with them. This is the part that does something with them —
 * pairs them up, and works out when each pair should go out.
 *
 * All of it pure. When a post is due is a question with one right answer, and
 * that answer should not depend on what a database happens to hold.
 */

export type PhotoKind = "before" | "during" | "after" | "issue";

export interface PhotoLike {
  id: string;
  kind: PhotoKind;
  zone_id: string | null;
  zone_name: string | null;
  created_at: string;
}

export interface BeforeAfterPair<T extends PhotoLike> {
  before: T;
  after: T;
  zoneId: string | null;
  zoneName: string | null;
}

/**
 * Matches the befores to the afters.
 *
 * Paired within a zone rather than across the job, because "before" and
 * "after" only mean anything about the same patch of ground — a before of the
 * front bed next to an after of the back garden is not a transformation, it
 * is two photographs.
 *
 * Within a zone they pair in the order they were taken, which is the order
 * the crew walked it.
 */
export function pairPhotos<T extends PhotoLike>(photos: T[]): BeforeAfterPair<T>[] {
  const byZone = new Map<string, T[]>();
  for (const photo of photos) {
    const key = photo.zone_id ?? "";
    const list = byZone.get(key) ?? [];
    list.push(photo);
    byZone.set(key, list);
  }

  const pairs: BeforeAfterPair<T>[] = [];

  for (const group of byZone.values()) {
    const befores = group.filter((p) => p.kind === "before").sort(byCreated);
    const afters = group.filter((p) => p.kind === "after").sort(byCreated);

    for (let i = 0; i < Math.min(befores.length, afters.length); i++) {
      pairs.push({
        before: befores[i],
        after: afters[i],
        zoneId: befores[i].zone_id,
        zoneName: befores[i].zone_name ?? afters[i].zone_name,
      });
    }
  }

  return pairs;
}

// ============================================================
// When it goes out
// ============================================================

export interface PostingSlot {
  /** 0 = Sunday. */
  weekday: number;
  /** Local hour, 24h. */
  hour: number;
}

/**
 * When people round here are actually looking.
 *
 * Mid-morning and just after work, on the days somebody is thinking about
 * their garden — the weekend either side, and midweek evenings. Not a
 * schedule anybody optimised; a schedule anybody can argue with and change in
 * one place.
 */
export const POSTING_SLOTS: readonly PostingSlot[] = [
  { weekday: 2, hour: 10 }, // Tuesday morning
  { weekday: 3, hour: 17 }, // Wednesday, after work
  { weekday: 4, hour: 10 }, // Thursday morning
  { weekday: 5, hour: 17 }, // Friday, after work
  { weekday: 6, hour: 10 }, // Saturday morning
  { weekday: 0, hour: 12 }, // Sunday lunchtime
];

/** Where the work is. Slot hours mean this clock, not the server's. */
export const POSTING_TIMEZONE = "America/New_York";

/** Two posts an hour apart reads as a bot. This is the floor between them. */
export const MIN_HOURS_BETWEEN_POSTS = 20;

/** How far ahead to look before giving up. */
const HORIZON_DAYS = 90;

/**
 * The next free slot.
 *
 * Free means: it is a posting slot, it is far enough after now, and it is far
 * enough from everything already booked — which is the whole "based on what
 * is already scheduled" part. Hand it the existing schedule and it fills the
 * first gap, so approving five posts in one sitting spreads them over a
 * fortnight instead of dumping five on a Tuesday.
 *
 * Walks real hours and reads each one's local clock, so it stays right across
 * a daylight-saving change rather than drifting by an hour for half the year.
 */
export function nextPostSlot(
  alreadyScheduled: (string | Date)[],
  from: string | Date = new Date()
): Date | null {
  const start = new Date(from);
  const taken = alreadyScheduled
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));

  const gapMs = MIN_HOURS_BETWEEN_POSTS * 3_600_000;

  // Start from the top of the next hour — a slot is an hour, not a moment.
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  cursor.setUTCHours(cursor.getUTCHours() + 1);

  for (let step = 0; step < HORIZON_DAYS * 24; step++) {
    const candidate = new Date(cursor.getTime() + step * 3_600_000);
    const local = localParts(candidate);

    const isSlot = POSTING_SLOTS.some(
      (slot) => slot.weekday === local.weekday && slot.hour === local.hour
    );
    if (!isSlot) continue;

    const clashes = taken.some((time) => Math.abs(time - candidate.getTime()) < gapMs);
    if (clashes) continue;

    return candidate;
  }

  return null;
}

/** A candidate hour's weekday and hour on the clock where the work is. */
function localParts(date: Date): { weekday: number; hour: number } {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: POSTING_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const weekdayName = formatted.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourValue = formatted.find((p) => p.type === "hour")?.value ?? "0";

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    weekday: Math.max(0, weekdays.indexOf(weekdayName)),
    // Intl renders midnight as 24 under hour12:false in some runtimes.
    hour: Number(hourValue) % 24,
  };
}

/** How a slot reads to a person. */
export function describeSlot(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: POSTING_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

// ============================================================
// What it says
// ============================================================

export interface CaptionInput {
  services: string[];
  zoneName?: string | null;
  city?: string | null;
  phone: string;
}

/**
 * A first draft of the caption, never the last word.
 *
 * Written to be edited: it puts the work, the place and the number in, which
 * are the three things a post has to carry, and leaves the personality to
 * whoever presses approve.
 */
export function suggestCaption(input: CaptionInput): string {
  const work = input.services.length > 0 ? input.services.join(" and ") : "Yard work";
  const where = input.city ? ` in ${input.city}` : " in Harford County";
  const zone = input.zoneName ? ` — ${input.zoneName}` : "";

  return [
    `${work}${where}${zone}. Swipe for the before.`,
    "",
    "Rated 5.0 on Google by our neighbors.",
    `Free estimates — call or text ${input.phone}.`,
  ].join("\n");
}

/**
 * The town out of a full address, and nothing else.
 *
 * A post says where the work was because that is how a local business gets
 * found. It must never say whose house it was, so the street line is dropped
 * on the way through rather than trimmed at the point of use — the one place
 * that reads an address for a public caption is the one place to make sure.
 */
export function townFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  // "123 Main St, Bel Air, MD 21014" -> the middle. Anything without a
  // street line in front of it is not an address we should be guessing at.
  if (parts.length < 2) return null;

  const town = parts[parts.length - 2];
  // A bare state-and-zip means the town was never in there.
  if (!town || /^[A-Z]{2}\s*\d{5}/.test(town)) return null;

  return town;
}

/** Posts that are due to go out. */
export function duePosts<T extends { scheduledFor: string | null; status: string }>(
  posts: T[],
  now: string | Date = new Date()
): T[] {
  const cutoff = new Date(now).getTime();
  return posts.filter(
    (post) =>
      post.status === "scheduled" &&
      post.scheduledFor != null &&
      new Date(post.scheduledFor).getTime() <= cutoff
  );
}

function byCreated(a: PhotoLike, b: PhotoLike): number {
  return a.created_at.localeCompare(b.created_at);
}
