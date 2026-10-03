/**
 * Where each project out today has got to, for the account manager: one bar,
 * eight steps, from the crew's own taps. At the shop, the tools loaded, out
 * of the shop, at the house, prepping each area, installing each area, the
 * clean up once every after photo is approved, and the walkthrough asked for.
 *
 * Pure, so where a project is shown to be is tested without a database.
 */

export const PROJECT_STEPS = ["At shop", "Tools loaded", "Left shop", "Arrived", "Prep", "Install", "Cleanup", "Walkthrough"] as const;

export type ProjectStep = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AreaProgress {
  name: string;
  location: string | null;
  prepped: boolean;
  done: boolean;
  /** Somebody is in it now. */
  working: boolean;
}

export interface StageInput {
  /** The crew go straight to the house with their own tools: no shop. */
  meetOnSite: boolean;
  /** When the crew got to the shop, loaded the tools, left, got to this house: null if not yet. */
  atShopAt: string | null;
  loadedAt: string | null;
  leftShopAt: string | null;
  arrivedAt: string | null;
  areas: AreaProgress[];
  /** The walkthrough was asked for. */
  walkthroughAskedAt: string | null;
  /** Areas whose newest after photo the account manager hasn't approved yet. The clean up waits on them. */
  aftersToApprove?: number;
}

export interface Stage {
  step: ProjectStep;
  /** What they are doing, in a line. */
  now: string;
  /** Since when, when it is known. */
  since: string | null;
  areasDone: number;
  areasTotal: number;
}

function which(areas: AreaProgress[], pick: (a: AreaProgress) => boolean): { area: AreaProgress; index: number } | null {
  const index = areas.findIndex(pick);
  return index >= 0 ? { area: areas[index], index } : null;
}

function named(a: AreaProgress, index: number, total: number): string {
  return `${a.name} (${index + 1} of ${total})${a.location ? `, ${a.location.toLowerCase()}` : ""}`;
}

export function projectStage(input: StageInput): Stage {
  const total = input.areas.length;
  const done = input.areas.filter((a) => a.done).length;
  const base = { areasDone: done, areasTotal: total };

  const allDone = total > 0 && done === total;
  if (input.walkthroughAskedAt) {
    return { ...base, step: 7, now: "Every area done. Asked you to walk it", since: input.walkthroughAskedAt };
  }
  if (allDone && input.arrivedAt) {
    // Every area installed: the after photos are approved, then the clean up.
    const waiting = input.aftersToApprove ?? 0;
    if (waiting > 0) {
      return { ...base, step: 5, now: `Every area done. ${waiting === 1 ? "1 after photo" : `${waiting} after photos`} to approve`, since: null };
    }
    return { ...base, step: 6, now: "After photos approved. Cleaning up", since: null };
  }
  if (input.arrivedAt) {
    const allPrepped = total > 0 && input.areas.every((a) => a.prepped || a.done);
    if (!allPrepped) {
      const at = which(input.areas, (a) => a.working && !a.prepped) ?? which(input.areas, (a) => !a.prepped && !a.done);
      return { ...base, step: 4, now: at ? `Prepping ${named(at.area, at.index, total)}` : "Getting started", since: input.arrivedAt };
    }
    const at = which(input.areas, (a) => a.working && !a.done) ?? which(input.areas, (a) => !a.done);
    return { ...base, step: 5, now: at ? `Installing ${named(at.area, at.index, total)}` : "Installing", since: null };
  }
  // No shop for them: the first three steps are not theirs to do.
  if (input.meetOnSite) {
    return { ...base, step: 3, now: "Meeting on site, not there yet", since: null };
  }
  if (input.leftShopAt) return { ...base, step: 3, now: "On the way", since: input.leftShopAt };
  if (input.loadedAt) return { ...base, step: 2, now: "Loaded, leaving the shop", since: input.loadedAt };
  if (input.atShopAt) return { ...base, step: 1, now: "At the shop, loading the tools", since: input.atShopAt };
  return { ...base, step: -1, now: "Not at the shop yet", since: null };
}

/**
 * A later stop on a crew's day: out of the shop, but at an earlier job
 * first. "On the way" there reads as if they are driving to it now.
 */
export function afterEarlierStop(stage: Stage, earlierClient: string | null): Stage {
  if (stage.step !== 3 || !earlierClient) return stage;
  return { ...stage, now: `At ${earlierClient}'s first. This is the next stop`, since: null };
}

/** How far along a step is on the bar: done, the one they are on, or still to come. */
export function stepState(step: number, current: ProjectStep): "done" | "now" | "todo" {
  if (step < current) return "done";
  if (step === current) return "now";
  return "todo";
}
