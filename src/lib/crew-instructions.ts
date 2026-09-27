/**
 * What the crew do in an area, in plain words.
 *
 * The evaluator's answers are selections ("Cleanup type: General", "Edge:
 * Existing Edge Needs Redone"). They describe the area; they do not tell
 * anyone what to pick up first. The crew sheet reads this instead: one line
 * per thing to do, in the order it gets done, each in its phase. The prep
 * is always the full prep whatever was selected; the work is what goes in;
 * the clean up ends every area.
 *
 * The same lines are the checklist on site: the crew prep every area first,
 * ticking these prep lines, then do the work, then clean up.
 */

import type { Phase } from "@/lib/area-work";

type Values = Record<string, string | undefined>;

export interface CrewStep {
  phase: Phase;
  label: string;
}

/** A select's answer, or null when it is blank, None, or Other with nothing said. */
function pick(values: Values, key: string): string | null {
  const v = values[key]?.trim();
  if (!v || v === "None") return null;
  if (v === "Other") return values[`${key}__other`]?.trim() || null;
  return v;
}

function text(values: Values, key: string): string | null {
  return values[key]?.trim() || null;
}

/** A free-text answer that says there is nothing, e.g. "None" or "No plants". */
function saysNothing(v: string): boolean {
  return /^(no|none|nothing|n\/?a|no plants?|no bushes|nope)\.?$/i.test(v.trim());
}

/** "3 bushes", "the bushes marked on the map and photos", or "every bush". */
function howMany(values: Values, key: string, one: string, many: string): string | null {
  const choice = pick(values, key);
  if (!choice) return null;
  const qty = Number(values[`${key}__qty`]);
  if (qty > 0) return `${qty} ${qty === 1 ? one : many}`;
  return /^all/i.test(choice) ? `every ${one}` : `the ${many} marked on the map and photos`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function plural(kind: string, qty: number): string {
  const k = lower(kind);
  if (qty === 1) return k;
  return k === "bush" ? "bushes" : `${k}s`;
}

const UTILITIES = "Look for marked utility lines before you dig. If anything is unmarked and in the way, ask first.";
const CLEAN_UP = "Blow off the walks, driveway and beds, and haul away every bit of debris.";

/** Collects the lines phase by phase, in the order they are written. */
function phased() {
  const out: CrewStep[] = [];
  return {
    prep: (label: string) => out.push({ phase: "prep", label }),
    work: (label: string) => out.push({ phase: "work", label }),
    cleanup: (label: string) => out.push({ phase: "cleanup", label }),
    done: () => out,
  };
}

function landscapeBed(v: Values): CrewStep[] {
  const s = phased();
  const material = pick(v, "material");
  const existing = pick(v, "existingMaterial");
  const condition = pick(v, "existingMaterialCondition");

  if (pick(v, "bedWork") === "New Creation") s.prep("Lay out the new bed, strip the grass inside it, and turn the soil over.");
  s.prep("Clear out all the leaves, sticks and any debris in the bed.");
  s.prep(pick(v, "weedLevel") === "Heavy" ? "Pull every weed, roots and all. It's heavy in here, so give it the time it needs." : "Pull every weed, roots and all.");

  // A change of material means the old one comes out, all of it.
  if (existing && material && existing !== material) {
    s.prep(`Take out all the old ${lower(existing)}, down to the soil. The bed is changing to ${lower(material)}.`);
  } else if (existing && condition === "Needs Removal") {
    s.prep(`Take out all the old ${lower(existing)}, down to the soil.`);
  } else if (existing && condition === "Excessive") {
    s.prep(`Pull out the extra old ${lower(existing)} so the new layer doesn't end up too deep.`);
  }

  const trim = howMany(v, "bushTrimming", "bush", "bushes");
  if (trim) s.prep(`Trim ${trim}.`);
  const removeBushes = howMany(v, "bushRemoval", "bush", "bushes");
  if (removeBushes) s.prep(`Take out ${removeBushes}, roots and all, and fill the holes.`);
  const removePlants = howMany(v, "plantRemoval", "plant", "plants");
  if (removePlants) s.prep(`Take out ${removePlants}, roots and all.`);

  const edge = pick(v, "edge");
  if (edge === "Existing Good Edge") s.prep("Touch up the edge so the line is clean all the way round.");
  else if (edge === "No Edge") s.prep("Cut a new edge: spade straight down 3 to 4 inches and lift the wedge out, all the way round.");
  else s.prep("Re-cut the edge: spade straight down 3 to 4 inches and lift the wedge out, all the way round.");

  const move = howMany(v, "plantRelocation", "plant", "plants");
  if (move) s.work(`Dig up and move ${move} to where they're marked.`);
  if (pick(v, "newPlantInstallation")) {
    const qty = Number(v.newPlantInstallation__qty);
    const which = qty > 0 ? `the ${qty === 1 ? "new plant" : `${qty} new plants`}` : "the new plants";
    s.work(`Plant ${which} where they're marked, root ball level with the ground, and water them in.`);
  }
  if (material === "Rock") s.work("Lay the new stone even across the whole bed, with no soil showing through.");
  else if (material) s.work(`Lay fresh ${lower(material)} 2 to 3 inches deep, raked level and pulled back off every stem.`);
  s.cleanup(CLEAN_UP);
  return s.done();
}

function plantBushRemoval(v: Values): CrewStep[] {
  const s = phased();
  const qty = Number(v.quantity);
  const size = pick(v, "size");
  const noun = plural(pick(v, "type") ?? "Plant", qty);
  s.prep(UTILITIES);
  s.prep(`Take out the ${qty > 1 ? `${qty} ` : ""}${size ? `${lower(size)} ` : ""}${noun} and dig out ${qty === 1 ? "the root ball" : "the root balls"}.`);
  s.work("Fill each hole with soil and tamp it level.");
  const after = pick(v, "afterward");
  if (after === "Return to Lawn") s.work("Spread topsoil over the spot, then seed it.");
  else if (after === "Return to Landscape Bed") s.work("Put the bed back over the spot, with its mulch or stone to match.");
  else if (after === "New Plant Installed") s.work("Leave the hole dug and ready for the new plant.");
  else if (after && /^(just|nothing|none)\b/i.test(after)) s.work("Leave the spot level and raked clean.");
  else if (after) s.work(`Afterward: ${after}.`);
  s.cleanup(CLEAN_UP);
  return s.done();
}

function plantInstallation(v: Values): CrewStep[] {
  const s = phased();
  const qty = Number(v.quantity);
  const plant = text(v, "plant") ?? "the plants";
  const size = text(v, "sizeContainer");
  const where = text(v, "locationWithinZone");
  if (pick(v, "installationType") === "Replacement") s.prep("Take out the old plant, roots and all.");
  s.prep(UTILITIES);
  s.prep("Set each plant where it goes before you dig.");
  s.work(`Plant ${qty > 0 ? `${qty} ` : ""}${plant}${size ? ` (${size})` : ""}${where ? `, ${lower(where)}` : ""}.`);
  s.work("Set each root ball level with the ground, backfill, and water it in.");
  s.work("Put the bed back around them, with the mulch pulled back off each stem.");
  s.cleanup(CLEAN_UP);
  return s.done();
}

function trimming(v: Values): CrewStep[] {
  const s = phased();
  const qty = Number(v.quantity);
  s.prep("Lay tarps under what you're cutting, and check for wires and sprinkler heads.");
  s.work(`Trim ${qty > 1 ? `the ${qty}` : "the"} ${plural(pick(v, "type") ?? "Bush", qty)}.`);
  const condition = pick(v, "condition");
  if (condition === "Severely Overgrown" || condition === "Overgrown") s.work("They're overgrown: cut them back hard, but no more than a third of any one plant at a time.");
  const result = text(v, "desiredResult");
  if (result) s.work(`The client wants: ${result}.`);
  s.work("Pull the cut branches out from inside each one.");
  s.cleanup(CLEAN_UP);
  return s.done();
}

function landscapeCleanup(v: Values): CrewStep[] {
  const s = phased();
  const staying = text(v, "plantsStaying");
  if (staying && !saysNothing(staying)) s.prep(`Leave these where they are: ${staying}.`);
  s.prep("Remove all the leaves, sticks and any debris.");
  const type = pick(v, "cleanupType");
  if (type === "Property Reset") s.work("Take the whole area back to clean: everything unwanted comes out.");
  else if (type && /brush/i.test(type)) s.work("Cut out all the brush, down to the ground, and haul it away.");
  if (pick(v, "overgrowth")) s.work("Cut back all the overgrowth.");
  if (pick(v, "vines")) s.work("Pull the vines down and out, roots and all.");
  if (pick(v, "saplings")) s.work("Dig out the small saplings, roots and all.");
  s.work("Pull every weed, roots and all.");
  s.cleanup(CLEAN_UP);
  return s.done();
}

function leafCleanup(v: Values): CrewStep[] {
  const s = phased();
  const type = pick(v, "type");
  s.prep("Clear the sticks and anything the blower would throw.");
  if (pick(v, "leafVolume") === "Heavy" || pick(v, "leafVolume") === "Extreme") s.prep("It's a heavy load: lay out the tarps and plan for more than one haul.");
  if (type !== "Fall Cutback") s.work("Rake and blow out every leaf: the lawn, the beds, the corners, behind the shrubs and along the fences.");
  if (type === "Fall Cutback" || type === "Full Fall Cleanup") {
    const which = text(v, "grassesToCutBack");
    s.work(which ? `Cut back ${lower(which)}.` : "Cut back the ornamental grasses and perennials.");
  }
  s.cleanup(CLEAN_UP);
  return s.done();
}

function lawnRestoration(v: Values): CrewStep[] {
  const s = phased();
  if (pick(v, "condition") === "Landscape-to-Lawn Conversion") s.prep("Take out everything in the old bed: mulch or stone, fabric and roots.");
  s.prep("Flag the sprinkler heads and anything in the ground.");
  s.prep("Rake out the dead grass and loosen the top of the soil.");
  if (pick(v, "soilCondition") === "Needs Topsoil") s.prep("Spread topsoil across it.");
  if (pick(v, "grade") === "Needs Correction") s.prep("Regrade it so it's even and runs away from the house.");
  s.work("Spread the seed evenly, rake it in, and cover it with straw.");
  s.cleanup(CLEAN_UP);
  return s.done();
}

function lawnCare(v: Values): CrewStep[] {
  const s = phased();
  const what = pick(v, "serviceType");
  s.prep("Walk the lawn and pick up sticks, toys and rocks.");
  if (what === "Fertilization") s.work("Spread the fertilizer evenly across the lawn.");
  else if (what === "Weed Control") s.work("Spray the weeds in the lawn, following the label.");
  else if (what === "Aeration") s.work("Core aerate the whole lawn.");
  else if (what === "Overseeding") s.work("Seed the thin and bare spots.");
  else if (what === "Edging") s.work("Edge along every walk, drive and bed.");
  else s.work("Mow, edge along every walk, drive and bed, and string trim what the mower can't reach.");
  const special = text(v, "specialInstructions");
  if (special) s.work(`${special}.`);
  s.cleanup("Blow the clippings off the walks, driveway and beds.");
  return s.done();
}

function grading(v: Values): CrewStep[] {
  const s = phased();
  s.prep(UTILITIES);
  s.work("Regrade the area so it's even.");
  const direction = text(v, "waterDirection");
  if (direction) s.work(`Water needs to run ${lower(direction)}.`);
  else if (pick(v, "purpose") === "Drainage") s.work("Slope it so water runs away from the house.");
  s.work("Tamp it firm, then rake the top smooth.");
  s.cleanup(CLEAN_UP);
  return s.done();
}

function softWashing(v: Values): CrewStep[] {
  const s = phased();
  const surface = pick(v, "surface");
  const material = text(v, "materialType");
  s.prep("Close the windows and doors, cover the outlets and fixtures, and wet the plants below.");
  s.work(`Soft wash the ${surface ? lower(surface) : "surface"}${material ? ` (${material})` : ""}.`);
  const stains = text(v, "stainingAreas");
  if (stains) s.work(`Give these extra attention: ${stains}.`);
  s.cleanup("Rinse everything around it, plants included, and put back what you moved.");
  return s.done();
}

const BY_TYPE: Record<string, (v: Values) => CrewStep[]> = {
  "landscape-bed": landscapeBed,
  "plant-bush-removal": plantBushRemoval,
  "plant-installation": plantInstallation,
  trimming,
  "landscape-cleanup": landscapeCleanup,
  "leaf-seasonal-cleanup": leafCleanup,
  "lawn-restoration": lawnRestoration,
  "lawn-care": lawnCare,
  grading,
  "soft-washing": softWashing,
};

/** The area's steps, phase by phase, or null for a service with no words yet. */
export function crewSteps(typeId: string, values: Values): CrewStep[] | null {
  const build = BY_TYPE[typeId];
  return build ? build(values) : null;
}

/** One line per thing to do in the area, in order. */
export function crewInstructions(typeId: string, values: Values): string[] {
  const steps = crewSteps(typeId, values);
  if (steps) return steps.map((s) => s.label);
  // A service we have no words for yet: say what was noted, plainly.
  return Object.entries(values)
    .filter(([key, value]) => value && !key.includes("__"))
    .map(([, value]) => `${value}.`);
}
