/**
 * Which crew sheet a job gets.
 *
 * The start buttons moved into each area's own card, and an area that has
 * been started lists only what is being done now. That is for jobs from
 * here on. A job already under way when it changed keeps the sheet its crew
 * started on, so nobody's screen rearranges itself in the middle of a job.
 *
 * Under way means either of: its first work day was on or before the day it
 * changed, or its crew had already started an area or ticked a step before
 * the moment it changed. Both are in the past, so the answer never flips
 * part way through a job.
 */

/** When the new sheet went live. */
export const NEW_CREW_SHEET_AT = "2026-09-29T15:35:00Z";
/** The day it went live, where the business is: work days on or before it keep the old sheet. */
export const NEW_CREW_SHEET_DAY = "2026-09-29";

export function usesPreviousCrewSheet(job: {
  /** The earliest work day scheduled, "YYYY-MM-DD", or null. */
  firstWorkDay: string | null;
  /** The earliest moment an area was started or a step ticked, or null. */
  firstWorkAt: string | null;
}): boolean {
  if (job.firstWorkDay && job.firstWorkDay <= NEW_CREW_SHEET_DAY) return true;
  if (job.firstWorkAt && new Date(job.firstWorkAt).getTime() < new Date(NEW_CREW_SHEET_AT).getTime()) return true;
  return false;
}
