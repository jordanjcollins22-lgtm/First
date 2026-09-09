/**
 * Whether we come out to look at it, or do it from here.
 *
 * The business is in Harford County. Work further out is still worth having —
 * a job is a job — but sending somebody an hour and a half each way to quote a
 * patio is how a free evaluation stops being free. So the far ones happen
 * over a screen: the client sends photos and walks us round on a video call,
 * and the same evaluator does the same work without the drive.
 *
 * Decided from the address rather than asked, because a client has no idea
 * where our county line is and asking them makes it their problem. They are
 * told which one they are getting and why, in a sentence, before they pick a
 * time.
 *
 * Coordinates only, never the address text. The existing property table holds
 * a Bel Air street geocoded to Missouri and another to Australia, so text and
 * pins disagree — but for this decision a wrong pin means at worst a video
 * call somebody could have had in person, which a phone call fixes. Reading
 * the text as well would mean two sources to disagree and no tiebreak.
 */

import { withinHarford } from "@/lib/address-quality";
import { metresBetween } from "@/lib/navigation";

export type EvaluationMode = "in_person" | "digital";

/** Bel Air, near enough. Distances are measured from here. */
const BASE = { lat: 39.5359, lng: -76.3483 };

/**
 * How far outside the county still gets a visit.
 *
 * "Harford or nearby" is the rule, and nearby has to be a number. Twenty-five
 * miles from Bel Air reaches well into Baltimore County, Cecil and the top of
 * Baltimore City without reaching anywhere that costs a morning.
 */
export const NEARBY_MILES = 25;

const METRES_PER_MILE = 1609.344;

export interface ModeDecision {
  mode: EvaluationMode;
  /** For the office: why this address got this treatment. */
  why: string;
  /** For the client, before they pick a time. Plain, and never apologetic. */
  says: string;
}

/**
 * Which kind of evaluation an address gets.
 *
 * An address we cannot place gets a visit. Being wrong that way costs one
 * drive; being wrong the other way tells somebody in Bel Air they are too far
 * away, which loses the job and is insulting.
 */
export function modeForAddress(lat: number | null, lng: number | null): ModeDecision {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      mode: "in_person",
      why: "No coordinates on the address, so it is treated as local.",
      says: "One of our evaluators will come out to you.",
    };
  }

  if (withinHarford(lat, lng)) {
    return {
      mode: "in_person",
      why: "Harford County.",
      says: "One of our evaluators will come out to you.",
    };
  }

  const miles = metresBetween(BASE, { lat, lng }) / METRES_PER_MILE;
  if (miles <= NEARBY_MILES) {
    return {
      mode: "in_person",
      why: `${Math.round(miles)} miles from Bel Air — close enough to drive.`,
      says: "One of our evaluators will come out to you.",
    };
  }

  return {
    mode: "digital",
    why: `${Math.round(miles)} miles from Bel Air — outside the driving area.`,
    says:
      "You're outside our usual driving area, so this one is a video walkthrough. " +
      "Same evaluator, same quote — you show us round on a call instead of us turning up.",
  };
}

/** What the office calls it on a job. */
export function modeLabel(mode: EvaluationMode): string {
  return mode === "digital" ? "Video walkthrough" : "On site";
}
