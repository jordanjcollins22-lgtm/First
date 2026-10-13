/**
 * Putting ready jobs on the calendar without a dispatcher.
 *
 * The schedule engine already knows the best day and crew for a job; it just
 * waited for somebody to press a button. This decides when that button can
 * press itself: the job was sold after auto-placement went live, it is ready,
 * its length is known, and the engine's best day has the whole crew-hours
 * free. Everything else that *could* be placed but does not fit cleanly is a
 * conflict, and conflicts are held for a person. Placing a job on a guess is
 * worse than not placing it, because the client is told the date.
 */

import { crewFor, type DayCapacity, type SchedulableJob, type Suggestion } from "@/lib/schedule-engine";

export type PlacementDecision =
  | { kind: "place"; suggestion: Suggestion }
  | { kind: "hold"; reason: string; suggestion: Suggestion | null }
  /** Not this automation's to touch (sold before go-live, or not ready yet). */
  | { kind: "skip"; reason: string };

export interface PlacementContext {
  /** When auto-placement went live. Jobs sold before it are never touched. */
  liveSince: string | null;
  /** When the job was sold (proposal accepted). */
  soldAt: string | null;
}

export function decidePlacement(
  job: SchedulableJob,
  suggestion: Suggestion | null,
  covered: boolean,
  ctx: PlacementContext
): PlacementDecision {
  if (!ctx.liveSince) return { kind: "skip", reason: "Auto-placement has not gone live." };
  if (!ctx.soldAt || ctx.soldAt < ctx.liveSince) return { kind: "skip", reason: "Sold before auto-placement went live." };
  if (!job.ready) return { kind: "skip", reason: "Not ready yet." };

  if (!job.hoursKnown || !(job.crewHours > 0)) {
    return { kind: "hold", reason: "No timing on the services, so the length would be a guess.", suggestion };
  }
  if (!suggestion) {
    return { kind: "hold", reason: "No day in the next four weeks has the crew free for it.", suggestion: null };
  }
  if (!covered) {
    return { kind: "hold", reason: `Not enough crew hours free on ${suggestion.date}; it would run over.`, suggestion };
  }
  if (job.clientPreferredDate && job.clientPreferredDate !== suggestion.date) {
    return {
      kind: "hold",
      reason: `The client asked for ${job.clientPreferredDate}; the nearest fit is ${suggestion.date}.`,
      suggestion,
    };
  }
  return { kind: "place", suggestion };
}

/**
 * Best day for each job, one at a time, taking capacity as it goes.
 *
 * The engine's own suggestSchedule does the same internally; doing it here
 * one job at a time also tells us whether the chosen day covered the hours,
 * which is the difference between placing a job and holding it.
 */
export function placeInOrder(
  jobs: readonly SchedulableJob[],
  days: readonly DayCapacity[],
  today: string,
  suggestOne: (job: SchedulableJob, days: DayCapacity[], today: string) => Suggestion | null
): { job: SchedulableJob; suggestion: Suggestion | null; covered: boolean }[] {
  const live: DayCapacity[] = days.map((d) => ({ ...d, crew: d.crew.map((c) => ({ ...c })), booked: [...d.booked] }));
  const order = [...jobs].sort((a, b) => (a.soldAt ?? "").localeCompare(b.soldAt ?? ""));
  const out: { job: SchedulableJob; suggestion: Suggestion | null; covered: boolean }[] = [];

  for (const job of order) {
    const suggestion = suggestOne(job, live, today);
    if (!suggestion) {
      out.push({ job, suggestion: null, covered: false });
      continue;
    }
    const day = live.find((d) => d.date === suggestion.date)!;
    const hours = job.hoursKnown && job.crewHours > 0 ? job.crewHours : 8;
    const covered = crewFor(day, hours).covered;
    out.push({ job, suggestion, covered });

    // Only a job that will actually be placed takes the capacity.
    if (covered && job.ready && job.hoursKnown) {
      let left = hours;
      for (const person of day.crew) {
        if (left <= 0) break;
        if (!suggestion.crewProfileIds.includes(person.profileId)) continue;
        const used = Math.min(person.freeHours, left);
        person.freeHours -= used;
        left -= used;
      }
      day.booked.push({ jobId: job.jobId, lat: job.lat, lng: job.lng });
    }
  }
  return out;
}

/** The text the client gets. Plain, with the date said the way people say it. */
export function placementNotice(input: { clientName: string | null; businessName: string; dateLabel: string; address: string | null }): string {
  const first = (input.clientName ?? "").trim().split(/\s+/)[0];
  return [
    `Hi ${first || "there"}, it's ${input.businessName || "your landscaper"}.`,
    `Your project${input.address ? ` at ${input.address}` : ""} is on our schedule for ${input.dateLabel}.`,
    "If that day doesn't work, just reply and we'll move it.",
  ].join(" ");
}
