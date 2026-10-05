/**
 * How a lawn restoration is actually done, from the walkthrough.
 *
 * Two very different jobs share the one kind of area. A full redo strips and
 * rakes the ground level, then seeds it and covers it with straw: slow, hand
 * work over every foot. A machine renovation runs a dethatcher and an aerator
 * over the lawn as it is and overseeds into it, a fraction of the time. The
 * evaluator's "How it's done" answer says which; on older walkthroughs that
 * never asked, the answers and notes are read for the machine work instead,
 * because pricing a renovation as a redo once came to ten thousand dollars of
 * raking nobody was going to do.
 */

export const LAWN_APPROACHES = ["Full Redo", "Dethatch, Aerate & Overseed", "Aerate & Overseed"] as const;

export interface LawnWork {
  /** Machine renovation: no soil prep, no straw, overseeded into the lawn that is there. */
  machine: boolean;
  dethatch: boolean;
  aerate: boolean;
}

const DETHATCH = /dethatch|de-thatch|power\s*rak|verti\s*-?cut/i;
const AERATE = /aerat/i;

export function lawnWork(values: Record<string, unknown>, notes: string | null = null): LawnWork {
  const approach = String(values.approach ?? "").trim();
  if (approach === "Full Redo") return { machine: false, dethatch: false, aerate: false };
  if (approach === "Dethatch, Aerate & Overseed") return { machine: true, dethatch: true, aerate: true };
  if (approach === "Aerate & Overseed") return { machine: true, dethatch: false, aerate: true };
  const said = [notes ?? "", ...Object.values(values).map((v) => (typeof v === "string" ? v : ""))].join(" ");
  const dethatch = DETHATCH.test(said);
  const aerate = AERATE.test(said);
  return { machine: dethatch || aerate, dethatch, aerate };
}
