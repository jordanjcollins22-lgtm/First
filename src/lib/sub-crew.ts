/**
 * A subcontractor's crew sheet: where they are up to, and each area's.
 *
 * They have no login and no crew day, so the sheet walks them through it
 * one button at a time: pick up at the shop (only when they use our
 * tools), On my way, I've arrived, then the areas one at a time. Every area
 * is prepped first, each closed by its prep photo; only then the work,
 * each area closed by its after photo. Then We're finished, which asks the
 * account manager to come and walk it.
 *
 * Pure, so the order is tested without a database.
 */

export type SubStage = "pickup" | "go" | "on_way" | "on_site" | "finished";

export interface SubProgress {
  usesOurTools: boolean;
  pickedUpAt: string | null;
  onWayAt: string | null;
  arrivedAt: string | null;
  finishedAt: string | null;
}

export function subStage(p: SubProgress): SubStage {
  if (p.finishedAt) return "finished";
  if (p.arrivedAt) return "on_site";
  if (p.onWayAt) return "on_way";
  if (p.usesOurTools && !p.pickedUpAt) return "pickup";
  return "go";
}

/** The one step to record next, from where they are. Null once finished. */
export function nextStep(p: SubProgress): "picked_up" | "on_way" | "arrived" | null {
  const stage = subStage(p);
  if (stage === "pickup") return "picked_up";
  if (stage === "go") return "on_way";
  if (stage === "on_way") return "arrived";
  return null;
}

export type AreaState = "todo" | "prepped" | "done";

/** An area's state from its photos: the after photo finishes it, the during photo means prep is done. */
export function areaState(kinds: string[]): AreaState {
  if (kinds.includes("after")) return "done";
  if (kinds.includes("during")) return "prepped";
  return "todo";
}

/** Every area is prepped (or already done): the work can start. */
export function subAllPrepped(states: AreaState[]): boolean {
  return states.every((s) => s !== "todo");
}

/**
 * The area they are on now: while prepping, the first one not prepped;
 * after that, the first one not done. Null when every area is done.
 */
export function currentArea<T extends { id: string }>(zones: T[], states: Record<string, AreaState>): { zone: T; kind: "during" | "after" } | null {
  const all = subAllPrepped(zones.map((z) => states[z.id] ?? "todo"));
  const zone = zones.find((z) => (states[z.id] ?? "todo") === (all ? "prepped" : "todo"));
  return zone ? { zone, kind: all ? "after" : "during" } : null;
}

/** Whether this photo can go on this area now. */
export function canTakePhoto(kind: "during" | "after", state: AreaState, allPrepped: boolean): { ok: true } | { ok: false; reason: string } {
  if (state === "done") return { ok: false, reason: "That area is finished." };
  if (kind === "during" && state !== "todo") return { ok: false, reason: "That area already has its prep photo." };
  if (kind === "after" && state === "todo") return { ok: false, reason: "Prep it and take the prep photo first." };
  if (kind === "after" && !allPrepped) return { ok: false, reason: "Every area gets prepped first. Prep the next area." };
  return { ok: true };
}

/** Whether they can say they are finished: every area has its after photo. */
export function canFinish(states: AreaState[]): { ok: true } | { ok: false; reason: string } {
  const left = states.filter((s) => s !== "done").length;
  if (states.length === 0) return { ok: true };
  if (left > 0) return { ok: false, reason: `${left} area${left === 1 ? "" : "s"} still need${left === 1 ? "s" : ""} the after photo.` };
  return { ok: true };
}

/** The shop arrival time, "07:00:00", as it is said: "7:00 am". */
export function sayTime(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
}
