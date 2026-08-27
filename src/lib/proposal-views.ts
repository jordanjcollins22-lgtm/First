/**
 * Reading the view log back as something the office can act on.
 *
 * "Sent" and "read" are different facts. A proposal nobody has opened wants a
 * nudge; one opened six times in two days wants a phone call. The number on
 * its own does not say which, so this works out the shape of it as well as
 * the count.
 *
 * Pure functions on plain rows, so the wording can be tested without a
 * database and can never differ between the job page and the proposals list.
 */

/** Anything closer together than this is one sitting, not two views. */
export const DEDUPE_MINUTES = 30;

/** Opened this many times or more, while still deciding, is a buying signal. */
export const KEEN_OPENS = 4;

export interface ViewRow {
  viewedAt: string;
  /** Null on rows written before we hashed, or where headers were missing. */
  visitorHash: string | null;
}

export interface ViewSummary {
  /** Times it was opened. */
  opens: number;
  /** How many different people, as far as we can tell. */
  people: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function summariseViews(rows: ViewRow[]): ViewSummary {
  if (rows.length === 0) {
    return { opens: 0, people: 0, firstAt: null, lastAt: null };
  }

  const times = rows
    .map((r) => r.viewedAt)
    .filter(Boolean)
    .sort();

  // An unhashed row cannot be told apart from another unhashed row, so each
  // counts as its own visitor rather than collapsing every anonymous open
  // into one person.
  const hashes = new Set<string>();
  let unknown = 0;
  for (const row of rows) {
    if (row.visitorHash) hashes.add(row.visitorHash);
    else unknown += 1;
  }

  return {
    opens: rows.length,
    people: hashes.size + unknown,
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
  };
}

/**
 * Whether a fresh view is the same sitting as the last one.
 *
 * A client who refreshes, rotates their phone, or comes back from the photo
 * they tapped has not read it twice, and a count that says they have is a
 * count nobody can act on.
 */
export function isSameSitting(lastViewedAt: string | null, now: Date): boolean {
  if (!lastViewedAt) return false;
  const last = new Date(lastViewedAt).getTime();
  if (Number.isNaN(last)) return false;
  const gap = now.getTime() - last;
  // A clock skewed into the future is not a reason to log a second view.
  if (gap < 0) return true;
  return gap < DEDUPE_MINUTES * 60_000;
}

/** "2 hours ago", "yesterday", "3 days ago". */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * The line the office reads.
 *
 * Says the count and when, because either alone is misleading: "opened 6
 * times" could be last month, and "opened 2 hours ago" could be the only
 * time they ever looked.
 */
export function viewLabel(summary: ViewSummary, now: Date): string {
  if (summary.opens === 0) return "Not opened yet";
  if (!summary.lastAt) return `Opened ${summary.opens} times`;

  const when = timeAgo(summary.lastAt, now);
  if (summary.opens === 1) return `Opened once, ${when}`;
  return `Opened ${summary.opens} times, last ${when}`;
}

/**
 * Somebody worth ringing.
 *
 * Repeated opens while a proposal is still unanswered is the closest thing to
 * a client putting their hand up. Once they have accepted or declined it is
 * just a receipt they keep going back to, so it stops meaning anything.
 */
export function isWarm(summary: ViewSummary, status: string): boolean {
  return status === "sent" && summary.opens >= KEEN_OPENS;
}
