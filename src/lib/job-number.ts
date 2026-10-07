/**
 * The number people say out loud.
 *
 * A job has a uuid, which is fine for a database and useless on a phone call.
 * Nobody has ever read 8f3a-4c21 to a client. "Job 1042" is something they can
 * quote back, a crew can write on a sheet, and two people can agree they are
 * talking about the same work.
 *
 * Formatting lives here rather than in each screen so the number a client
 * reads off a proposal is character-for-character the one the office searches
 * for. A number that is padded on one screen and not another is two numbers.
 */

/** Assigned by the database on insert. Null only on a row written before the
 * numbering existed and not yet backfilled. */
export type JobNumber = number | null;

const PREFIX = "#";

/**
 * The number as it appears everywhere.
 *
 * Padded to four digits so a list of them lines up and so job 42 and job 4200
 * are not mistaken for each other at a glance. Beyond four it simply grows —
 * truncating would be worse than a ragged column.
 */
export function formatJobNumber(value: JobNumber): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return `${PREFIX}${String(Math.floor(value)).padStart(4, "0")}`;
}

/**
 * A job's name for a human, in order of what actually identifies it.
 *
 * The address first, because that is what everybody involved calls the job.
 * The number second, because that is what they fall back on when two jobs
 * share an address — which happens the second time you work for somebody.
 */
export function jobLabel(jobNumber: JobNumber, address: string | null, fallbackName: string): string {
  const number = formatJobNumber(jobNumber);
  const place = address?.trim() || fallbackName.trim() || "Job";
  return number ? `${place} · ${number}` : place;
}

/**
 * Finds a job number inside whatever somebody typed.
 *
 * People search "1042", "#1042" and "job 1042" and mean the same thing, and a
 * search box that only accepts one of the three is a search box people stop
 * using.
 */
export function parseJobNumber(query: string): number | null {
  const match = query.trim().match(/(?:^|\D)(\d{1,9})\s*$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
