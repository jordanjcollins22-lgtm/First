/**
 * Whether we come out to look at it, or do it from here.
 *
 * The business is in Harford County, and the rule is the county line: an
 * address in Harford gets a visit, an address anywhere else gets a video
 * walkthrough. Work further out is still worth having, but sending somebody
 * an hour each way to quote a patio is how a free evaluation stops being
 * free, so the far ones happen over a screen: the client walks us round on
 * a video call and the same evaluator does the same work without the drive.
 *
 * Decided from the address rather than asked, because a client has no idea
 * where our county line is and asking them makes it their problem. They are
 * told which one they are getting and why, in a sentence, before they pick a
 * time.
 *
 * The pin decides when there is one. When there is not, the address text
 * gets a say: a Harford ZIP or a Harford town in Maryland is a visit, and
 * anything else is a video call. Being wrong costs one drive or one phone
 * call to swap it, either way.
 */

import { claimsHarford } from "@/lib/address-quality";
import { insideHarford } from "@/lib/harford-shape";

export type EvaluationMode = "in_person" | "digital";

export interface ModeDecision {
  mode: EvaluationMode;
  /** For the office: why this address got this treatment. */
  why: string;
  /** For the client, before they pick a time. Plain, and never apologetic. */
  says: string;
}

const VISIT = "One of our evaluators will come out to you.";
const VIDEO =
  "You're outside Harford County, our driving area, so this one is a video walkthrough. " +
  "Same evaluator, same quote. You show us round on a call instead of us turning up.";

/** Which kind of evaluation an address gets. */
export function modeForAddress(lat: number | null, lng: number | null, address?: string | null): ModeDecision {
  const placed = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  if (placed) {
    return insideHarford(lat, lng)
      ? { mode: "in_person", why: "Harford County.", says: VISIT }
      : { mode: "digital", why: "Outside Harford County.", says: VIDEO };
  }

  if (claimsHarford(address)) {
    return { mode: "in_person", why: "No pin on the address, but it reads as Harford County.", says: VISIT };
  }
  return {
    mode: "digital",
    why: "No pin on the address and it does not read as Harford County.",
    says: VIDEO,
  };
}

/** What the office calls it on a job. */
export function modeLabel(mode: EvaluationMode): string {
  return mode === "digital" ? "Video walkthrough" : "On site";
}
