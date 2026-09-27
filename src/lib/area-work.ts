/**
 * Working a job area by area, on site.
 *
 * Each area has a short checklist in three phases: prep, the work, and the
 * clean up. Prep done means a during photo; clean up done means the after
 * photo, and the after photo is what makes the area done. One photo per
 * area is enough, whoever takes it.
 *
 * The crew pick an area to start on. Two people can work one area or split
 * up. An area takes the kits its service needs, and a kit in one area is not
 * in another, so an area whose kit is being used somewhere else waits and
 * says where the kit is. When an area's after photo is in, its kits are free.
 *
 * And for each service, what to look for: the things that make work look
 * unfinished, said the way somebody on the job would say them.
 *
 * Every area is prepped before any area's work starts: the prep, then its
 * during photo, area after area, and only when the last one is in does the
 * work open anywhere. The steps are the area's own scope (crew-instructions),
 * so "prep this area" reads as what this area needs.
 *
 * Pure: the steps, the tips and the kit arithmetic are all tested here.
 */

import { crewSteps } from "@/lib/crew-instructions";

export type Phase = "prep" | "work" | "cleanup";

export interface AreaStep {
  key: string;
  label: string;
  phase: Phase;
}

export interface Tip {
  title: string;
  body: string;
}

export const PHASE_LABEL: Record<Phase, string> = {
  prep: "Prep",
  work: "The work",
  cleanup: "Clean up",
};

function steps(prep: string[], work: string[], cleanup: string[]): AreaStep[] {
  const make = (phase: Phase, labels: string[]) => labels.map((label, i) => ({ key: `${phase}-${i + 1}`, label, phase }));
  return [...make("prep", prep), ...make("work", work), ...make("cleanup", cleanup)];
}

const UTILITIES = "Look for marked utility lines before you dig. If anything is unmarked and in the way, ask first.";

const STEPS: Record<string, AreaStep[]> = {
  "landscape-bed": steps(
    ["Pull every weed, roots and all", "Cut a clean edge along the bed", "Rake out old debris and level the bed"],
    ["Spread the mulch or stone evenly, 2 to 3 inches deep", "Pull it back off stems, trunks and the house"],
    ["Blow or sweep it off the grass, walks and driveway", "Load the weeds and debris"]
  ),
  trimming: steps(
    ["Lay tarps under what you are cutting", "Check for wires, sprinkler heads and anything fragile"],
    ["Trim to the shape on the sheet", "Step back and check it looks even from the street"],
    ["Rake and blow every clipping out of the beds and off the grass", "Load the clippings"]
  ),
  "landscape-cleanup": steps(
    ["Pick up trash and large debris"],
    ["Pull the weeds and cut back dead growth", "Rake the beds clean"],
    ["Blow off the walks, patio and driveway", "Load everything that came out"]
  ),
  "leaf-seasonal-cleanup": steps(
    ["Clear sticks and anything the blower would throw"],
    ["Blow and rake the leaves onto tarps or into piles", "Get the leaves out of beds, corners and behind shrubs"],
    ["Load or bag every pile", "Blow off the driveway, walks and patio"]
  ),
  "plant-installation": steps(
    ["Set each plant where it goes before digging", UTILITIES],
    [
      "Dig each hole about twice as wide as the root ball and no deeper",
      "Loosen circling roots and set the plant level with the ground",
      "Backfill, firm the soil and water it in",
    ],
    ["Mulch around each plant, pulled back off the stem", "Pick up the pots, tags and loose soil"]
  ),
  "plant-bush-removal": steps(
    ["Check the sheet for exactly which plants come out", UTILITIES],
    ["Cut it down, then dig out the root ball", "Fill the hole and level it"],
    ["Rake the spot clean", "Load every branch and root"]
  ),
  "lawn-restoration": steps(
    ["Flag the sprinkler heads and anything in the ground", "Rake out dead grass and debris"],
    ["Spread the seed evenly at the rate on the sheet", "Rake it in lightly, and cover where the sheet says"],
    ["Blow the seed off walks and the driveway", "Pick up the flags and debris"]
  ),
  "lawn-care": steps(
    ["Walk the lawn and pick up sticks, toys and rocks"],
    ["Mow at the height on the sheet", "Trim along beds, fences and walls", "Edge along the walks and driveway"],
    ["Blow the clippings off every hard surface", "Blow the clippings out of the beds"]
  ),
  "soft-washing": steps(
    ["Close the windows and doors, cover outlets and fixtures", "Wet the plants below the area"],
    ["Apply the wash from the bottom up", "Rinse from the top down"],
    ["Rinse the plants again", "Uncover everything and put back what you moved"]
  ),
  grading: steps(
    [UTILITIES, "Check which way the ground has to fall: away from the house"],
    ["Move the soil so water runs away from the house", "Rake it smooth and firm it"],
    ["Clear the soil off walks and the driveway", "Load the leftover soil and debris"]
  ),
};

const DEFAULT_STEPS = steps(
  ["Read the sheet for this area", "Clear anything in the way"],
  ["Do the work on the sheet for this area"],
  ["Clean up every bit of debris", "Put back anything you moved"]
);

/**
 * An area's checklist. With the evaluator's answers, it is that area's own
 * scope, phase by phase; without them, or for a service with no words yet,
 * the service's general steps.
 */
export function stepsFor(serviceTypeId: string, values?: Record<string, string | undefined>): AreaStep[] {
  const own = values ? crewSteps(serviceTypeId, values) : null;
  if (own) {
    const count: Record<Phase, number> = { prep: 0, work: 0, cleanup: 0 };
    return own.map((step) => ({ key: `${step.phase}-${++count[step.phase]}`, label: step.label, phase: step.phase }));
  }
  return STEPS[serviceTypeId] ?? DEFAULT_STEPS;
}

const TIPS: Record<string, Tip[]> = {
  "landscape-bed": [
    { title: "Mulch too high", body: "More than 3 inches, or piled against trunks and stems. It rots the bark. Pull it back so every stem has a gap around it." },
    { title: "Mulch too thin", body: "Under 2 inches, or you can see soil or old mulch through it. The weeds come straight back." },
    { title: "Not even", body: "High and low spots. Rake it level so the bed reads as one colour from the street." },
    { title: "On the grass", body: "Mulch spilled over the edge onto the lawn or the walk. Blow it or pick it off before you leave." },
    { title: "How to dig an edge", body: "Push the spade straight down 3 to 4 inches along the line. Make a second cut angled in from the bed side and lift the wedge out. Follow curves in short cuts so the line stays smooth." },
    { title: "Weeds", body: "Pull them with the root, not just the top. If you do not know what something is, check the weed guide or ask." },
  ],
  trimming: [
    { title: "Shape", body: "Match the shape on the sheet. Natural means no flat tops or boxed sides." },
    { title: "Too much off", body: "Taking more than about a third of a shrub at once can kill it. If the sheet asks for more, ask first." },
    { title: "Hangers", body: "Cut branches left caught inside the shrub. Shake it and pull them out." },
  ],
  "lawn-care": [
    { title: "Missed strips", body: "Look back down every pass for uncut stripes." },
    { title: "Scalping", body: "Brown bald patches on high ground. Raise the deck there." },
    { title: "Clippings", body: "Nothing left on walks, the driveway, or in the beds." },
  ],
  "leaf-seasonal-cleanup": [
    { title: "Corners", body: "Leaves left in bed corners, behind shrubs and along fences are the first thing a client sees." },
    { title: "Matted leaves", body: "Wet leaves stuck flat on the lawn. Rake them up; the blower will not lift them." },
  ],
  "plant-installation": [
    { title: "Too deep", body: "The top of the root ball should sit level with the ground, not below it." },
    { title: "Mulch on the stem", body: "Keep mulch pulled back off the stem of every new plant." },
  ],
  "landscape-cleanup": [
    { title: "Edges", body: "Debris left along the bed edges and in the corners." },
    { title: "Hard surfaces", body: "Soil and clippings left on the walks, patio or driveway." },
  ],
};

const DEFAULT_TIPS: Tip[] = [{ title: "Not sure?", body: "Ask before you start, not after. The account manager's number is at the top of the sheet." }];

export function tipsFor(serviceTypeId: string): Tip[] {
  return TIPS[serviceTypeId] ?? DEFAULT_TIPS;
}

/* ------------------------------------------------------------------ kits */

export interface ToolRef {
  id: string;
  name: string;
  /** The kits this tool is packed in. Empty when it travels loose. */
  kits: number[];
}

export interface AreaNeeds {
  tools: string[];
  /** For each tool that lives in a kit, the kits that would do. */
  kitChoices: number[][];
}

export function areaNeeds(serviceTypeId: string, serviceTools: { service_type_id: string; tool_id: string }[], tools: ToolRef[]): AreaNeeds {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const mine = serviceTools
    .filter((link) => link.service_type_id === serviceTypeId)
    .map((link) => byId.get(link.tool_id))
    .filter((tool): tool is ToolRef => Boolean(tool));
  return {
    tools: [...new Set(mine.map((t) => t.name))].sort((a, b) => a.localeCompare(b)),
    kitChoices: mine.filter((t) => t.kits.length > 0).map((t) => [...t.kits].sort((a, b) => a - b)),
  };
}

export type KitPick = { ok: true; kits: number[] } | { ok: false; waitingOn: number[] };

/**
 * Which kits this area takes. A kit the area already holds (somebody is
 * working in it) is reused; otherwise the lowest-numbered free kit that
 * holds the tool. If some tool can only come from kits that are in use
 * elsewhere, the area waits, and says which.
 */
export function pickKits(needs: AreaNeeds, heldHere: ReadonlySet<number>, heldElsewhere: ReadonlySet<number>): KitPick {
  const chosen = new Set<number>(heldHere);
  const waiting = new Set<number>();
  for (const choices of needs.kitChoices) {
    if (choices.some((k) => chosen.has(k))) continue;
    const free = choices.find((k) => !heldElsewhere.has(k));
    if (free == null) choices.forEach((k) => waiting.add(k));
    else chosen.add(free);
  }
  if (waiting.size > 0) return { ok: false, waitingOn: [...waiting].sort((a, b) => a - b) };
  return { ok: true, kits: [...chosen].sort((a, b) => a - b) };
}

/* ------------------------------------------------------------ the board */

export interface BoardZone {
  id: string;
  name: string;
  serviceTypeId: string;
  /** The evaluator's answers, which make the area's own steps. */
  values?: Record<string, string | undefined>;
}

export interface WorkRow {
  zoneId: string;
  profileId: string;
  name: string;
  kits: number[];
}

export type AreaStatus = "done" | "working" | "open" | "waiting";

export interface AreaState {
  zoneId: string;
  status: AreaStatus;
  people: { profileId: string; name: string }[];
  kits: number[];
  /** The phase the area is in: the first phase with a step not ticked. */
  phase: Phase | "done";
  stepsDone: number;
  stepsTotal: number;
  hasDuring: boolean;
  hasAfter: boolean;
  /** Its prep is ticked and its during photo is in. */
  prepped: boolean;
  /** What the next photo is, when the steps before it are ticked and it is missing. */
  photoDue: "during" | "after" | null;
  /** Why it cannot be started yet: where the kit it needs is. */
  waitingReason: string | null;
  /** The kits it would take if somebody started it now. */
  wouldTake: number[];
}

export function boardState(input: {
  zones: BoardZone[];
  needs: Map<string, AreaNeeds>;
  working: WorkRow[];
  /** zoneId -> ticked step keys */
  ticked: Map<string, Set<string>>;
  photos: { zoneId: string | null; kind: string }[];
}): AreaState[] {
  // An area with its after photo is finished: whoever forgot to leave it is
  // not holding its kits any more.
  const finished = new Set(input.photos.filter((p) => p.kind === "after" && p.zoneId).map((p) => p.zoneId as string));
  const working = input.working.filter((w) => !finished.has(w.zoneId));
  const heldBy = new Map<number, string>();
  for (const row of working) for (const kit of row.kits) if (!heldBy.has(kit)) heldBy.set(kit, row.zoneId);
  const zoneName = new Map(input.zones.map((z) => [z.id, z.name]));

  return input.zones.map((zone) => {
    const people = working.filter((w) => w.zoneId === zone.id);
    const heldHere = new Set(people.flatMap((p) => p.kits));
    const heldElsewhere = new Set([...heldBy.entries()].filter(([, z]) => z !== zone.id).map(([k]) => k));
    const list = stepsFor(zone.serviceTypeId, zone.values);
    const ticks = input.ticked.get(zone.id) ?? new Set<string>();
    const hasDuring = input.photos.some((p) => p.zoneId === zone.id && p.kind === "during");
    const hasAfter = input.photos.some((p) => p.zoneId === zone.id && p.kind === "after");
    const firstOpen = list.find((s) => !ticks.has(s.key));
    const phase: Phase | "done" = hasAfter ? "done" : firstOpen ? firstOpen.phase : "done";
    const prepDone = list.filter((s) => s.phase === "prep").every((s) => ticks.has(s.key));
    const allDone = list.every((s) => ticks.has(s.key));
    const photoDue = hasAfter ? null : allDone ? "after" : prepDone && !hasDuring ? "during" : null;

    const pick = pickKits(input.needs.get(zone.id) ?? { tools: [], kitChoices: [] }, heldHere, heldElsewhere);
    let status: AreaStatus;
    let waitingReason: string | null = null;
    if (hasAfter) status = "done";
    else if (people.length > 0) status = "working";
    else if (pick.ok) status = "open";
    else {
      status = "waiting";
      const where = [...new Set(pick.waitingOn.map((k) => heldBy.get(k)).filter(Boolean) as string[])].map((z) => zoneName.get(z) ?? "another area");
      waitingReason = `Needs kit ${pick.waitingOn.join(" or ")}, in use in ${where.join(" and ") || "another area"}.`;
    }

    return {
      zoneId: zone.id,
      status,
      people: people.map((p) => ({ profileId: p.profileId, name: p.name })),
      kits: [...heldHere].sort((a, b) => a - b),
      phase,
      stepsDone: list.filter((s) => ticks.has(s.key)).length,
      stepsTotal: list.length,
      hasDuring,
      hasAfter,
      prepped: hasAfter || (prepDone && hasDuring),
      photoDue,
      waitingReason,
      wouldTake: pick.ok ? pick.kits : [],
    };
  });
}

/** Every area is prepped, with its during photo: the work can start. */
export function allPrepped(states: Pick<AreaState, "prepped">[]): boolean {
  return states.every((s) => s.prepped);
}

/**
 * Whether a step can be ticked now. The work waits on the area's prep and
 * its during photo, and on every other area being prepped too; the clean up
 * waits on the work, so the photos land where they belong.
 */
export function canTick(
  step: AreaStep,
  list: AreaStep[],
  ticked: ReadonlySet<string>,
  hasDuring: boolean,
  everyAreaPrepped = true
): { ok: true } | { ok: false; reason: string } {
  const prepDone = list.filter((s) => s.phase === "prep").every((s) => ticked.has(s.key));
  const workDone = list.filter((s) => s.phase === "work").every((s) => ticked.has(s.key));
  if (step.phase === "work" && !prepDone) return { ok: false, reason: "Finish the prep first." };
  if (step.phase === "work" && !hasDuring) return { ok: false, reason: "Take the prep photo first: prep is done." };
  if (step.phase !== "prep" && !everyAreaPrepped) return { ok: false, reason: "Every area gets prepped first. Prep the next area." };
  if (step.phase === "cleanup" && !workDone) return { ok: false, reason: "Finish the work first." };
  return { ok: true };
}
