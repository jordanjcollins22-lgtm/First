import type { NavState } from "@/lib/navigation";

/**
 * What to say out loud, and when.
 *
 * A screen can show the same instruction for a mile; a voice that repeats
 * it every second is a phone thrown out of the window. So the voice keeps
 * a short memory of what it has said and speaks only on a change: a new
 * turn coming up, that turn now close, arrival, and coming off the route.
 * Pure, so it can be tested without a phone in a truck.
 */
export interface SpeechMemory {
  /** The step the far-off announcement was made for. */
  farStep: number | null;
  /** The step the close-up announcement was made for. */
  nearStep: number | null;
  arrivedSaid: boolean;
  offRoute: boolean;
}

export const FRESH_MEMORY: SpeechMemory = { farStep: null, nearStep: null, arrivedSaid: false, offRoute: false };

/** Close enough that "in 300 feet" would be late by the time it is said. */
export const NEAR_METRES = 120;

const METRES_PER_FOOT = 0.3048;
const METRES_PER_MILE = 1609.344;

/** Distances the way they are read aloud: units spelt out, no decimals to mumble. */
export function speakableDistance(metres: number): string {
  const feet = metres / METRES_PER_FOOT;
  if (feet < 1000) {
    const rounded = feet < 150 ? Math.round(feet / 50) * 50 : Math.round(feet / 100) * 100;
    return `${Math.max(rounded, 50)} feet`;
  }
  const miles = metres / METRES_PER_MILE;
  if (miles < 1.05) return "1 mile";
  if (miles < 10) {
    const tenth = Math.round(miles * 10) / 10;
    return Number.isInteger(tenth) ? `${tenth} miles` : `${tenth.toFixed(1)} miles`;
  }
  return `${Math.round(miles)} miles`;
}

function lower(instruction: string): string {
  return instruction.length > 0 ? instruction[0].toLowerCase() + instruction.slice(1).replace(/\.$/, "") : "";
}

/** The first thing said when the route comes up. */
export function routeSummary(input: { customerName: string; address: string; metres: number; seconds: number }): string {
  const minutes = Math.max(1, Math.round(input.seconds / 60));
  return `Heading to ${input.customerName}, ${input.address}. ${speakableDistance(input.metres)}, about ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`;
}

/**
 * The next thing to say, if anything, and what to remember.
 *
 * Off-route is said once on the way out and once on the way back. Arrival
 * is said once. Each turn is said twice at most: as it comes into view,
 * and again when it is on top of the driver.
 */
export function nextAnnouncement(
  memory: SpeechMemory,
  nav: NavState,
  customerName: string
): { say: string | null; memory: SpeechMemory } {
  if (nav.arrived) {
    if (memory.arrivedSaid) return { say: null, memory };
    return { say: `You have arrived at ${customerName}.`, memory: { ...memory, arrivedSaid: true } };
  }

  if (nav.offRoute !== memory.offRoute) {
    const next = { ...memory, offRoute: nav.offRoute };
    return {
      say: nav.offRoute ? "You have come off the route." : "Back on the route.",
      memory: next,
    };
  }
  if (nav.offRoute) return { say: null, memory };

  const instruction = lower(nav.instruction);
  if (!instruction) return { say: null, memory };

  const near = nav.metresToTurn != null && nav.metresToTurn <= NEAR_METRES;

  if (near && memory.nearStep !== nav.stepIndex) {
    return {
      say: instruction[0].toUpperCase() + instruction.slice(1) + ".",
      memory: { ...memory, nearStep: nav.stepIndex, farStep: nav.stepIndex },
    };
  }

  if (!near && memory.farStep !== nav.stepIndex) {
    const distance = nav.metresToTurn != null ? `In ${speakableDistance(nav.metresToTurn)}, ` : "";
    return {
      say: `${distance}${distance ? instruction : instruction[0].toUpperCase() + instruction.slice(1)}.`,
      memory: { ...memory, farStep: nav.stepIndex },
    };
  }

  return { say: null, memory };
}

/** What the phone says when somebody taps "On my way". */
export function departureLine(stop: { customerName: string; address: string; purpose: string | null }): string {
  const parts = [`On your way to ${stop.customerName}, ${stop.address}.`];
  if (stop.purpose) parts.push(stop.purpose.replace(/\.?$/, "."));
  return parts.join(" ");
}
