/**
 * What the crew do in an area, in plain words.
 *
 * The evaluator's answers are selections ("Cleanup type: General", "Edge:
 * Existing Edge Needs Redone"). They describe the area; they do not tell
 * anyone what to pick up first. The crew sheet reads this instead: one line
 * per thing to do, in the order it gets done, starting with the prep, which
 * is always the full prep whatever was selected, and ending with the clean up.
 */

type Values = Record<string, string | undefined>;

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

/** "3 bushes", "the bushes the client picked", or "every bush". */
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

const CLEAN_UP = "Blow off the walks, driveway and beds, and haul away every bit of debris.";

function landscapeBed(v: Values): string[] {
  const out: string[] = [];
  const material = pick(v, "material");
  const existing = pick(v, "existingMaterial");
  const condition = pick(v, "existingMaterialCondition");

  if (pick(v, "bedWork") === "New Creation") out.push("Lay out the new bed, strip the grass inside it, and turn the soil over.");
  out.push("Clear out all the leaves, sticks and any debris in the bed.");

  const weeds = pick(v, "weedLevel");
  out.push(
    weeds === "Heavy"
      ? "Pull every weed, roots and all. It's heavy in here, so give it the time it needs."
      : "Pull every weed, roots and all."
  );

  // A change of material means the old one comes out, all of it.
  if (existing && material && existing !== material) {
    out.push(`Take out all the old ${lower(existing)}, down to the soil. The bed is changing to ${lower(material)}.`);
  } else if (existing && condition === "Needs Removal") {
    out.push(`Take out all the old ${lower(existing)}, down to the soil.`);
  } else if (existing && condition === "Excessive") {
    out.push(`Pull out the extra old ${lower(existing)} so the new layer doesn't end up too deep.`);
  }

  const trim = howMany(v, "bushTrimming", "bush", "bushes");
  if (trim) out.push(`Trim ${trim}.`);
  const removeBushes = howMany(v, "bushRemoval", "bush", "bushes");
  if (removeBushes) out.push(`Take out ${removeBushes}, roots and all, and fill the holes.`);
  const removePlants = howMany(v, "plantRemoval", "plant", "plants");
  if (removePlants) out.push(`Take out ${removePlants}, roots and all.`);
  const move = howMany(v, "plantRelocation", "plant", "plants");
  if (move) out.push(`Dig up and move ${move} to where they're marked.`);

  const edge = pick(v, "edge");
  if (edge === "Existing Good Edge") out.push("Touch up the edge so the line is clean all the way round.");
  else if (edge === "No Edge") out.push("Cut a new edge: spade straight down 3 to 4 inches and lift the wedge out, all the way round.");
  else out.push("Re-cut the edge: spade straight down 3 to 4 inches and lift the wedge out, all the way round.");

  if (pick(v, "newPlantInstallation")) {
    const qty = Number(v.newPlantInstallation__qty);
    const which = qty > 0 ? `the ${qty === 1 ? "new plant" : `${qty} new plants`}` : "the new plants";
    out.push(`Plant ${which} where they're marked, root ball level with the ground, and water them in.`);
  }

  if (material === "Rock") out.push("Lay the new stone even across the whole bed, with no soil showing through.");
  else if (material) out.push(`Lay fresh ${lower(material)} 2 to 3 inches deep, raked level and pulled back off every stem.`);
  out.push(CLEAN_UP);
  return out;
}

function plantBushRemoval(v: Values): string[] {
  const kind = pick(v, "type") ?? "Plant";
  const qty = Number(v.quantity);
  const size = pick(v, "size");
  const noun = lower(kind) === "bush" ? (qty === 1 ? "bush" : "bushes") : qty === 1 ? lower(kind) : `${lower(kind)}s`;
  const out = [`Take out the ${qty > 1 ? `${qty} ` : ""}${size ? `${lower(size)} ` : ""}${noun} and dig out ${qty === 1 ? "the root ball" : "the root balls"}.`];
  out.push("Fill each hole with soil and tamp it level.");
  const after = pick(v, "afterward");
  if (after === "Return to Lawn") out.push("Spread topsoil over the spot, then seed it.");
  else if (after === "Return to Landscape Bed") out.push("Put the bed back over the spot, with its mulch or stone to match.");
  else if (after === "New Plant Installed") out.push("Leave the hole dug and ready for the new plant.");
  else if (after) out.push(`Afterward: ${after}.`);
  out.push(CLEAN_UP);
  return out;
}

function plantInstallation(v: Values): string[] {
  const qty = Number(v.quantity);
  const plant = text(v, "plant") ?? "the plants";
  const size = text(v, "sizeContainer");
  const where = text(v, "locationWithinZone");
  const out: string[] = [];
  if (pick(v, "installationType") === "Replacement") out.push("Take out the old plant, roots and all.");
  out.push(`Plant ${qty > 0 ? `${qty} ` : ""}${plant}${size ? ` (${size})` : ""}${where ? `, ${lower(where)}` : ""}.`);
  out.push("Set each root ball level with the ground, backfill, and water it in.");
  out.push("Put the bed back around them, with the mulch pulled back off each stem.");
  out.push(CLEAN_UP);
  return out;
}

function trimming(v: Values): string[] {
  const qty = Number(v.quantity);
  const kind = pick(v, "type") ?? "Bush";
  const noun = lower(kind) === "bush" ? (qty === 1 ? "bush" : "bushes") : qty === 1 ? lower(kind) : `${lower(kind)}s`;
  const out = [`Trim ${qty > 0 ? qty : "the"} ${noun}.`];
  const condition = pick(v, "condition");
  if (condition === "Severely Overgrown" || condition === "Overgrown")
    out.push("They're overgrown: cut them back hard, but no more than a third of any one plant at a time.");
  const result = text(v, "desiredResult");
  if (result) out.push(`The client wants: ${result}.`);
  out.push("Pull the cut branches out from inside each one.");
  out.push(CLEAN_UP);
  return out;
}

function landscapeCleanup(v: Values): string[] {
  const out = ["Remove all the leaves, sticks and any debris."];
  if (pick(v, "cleanupType") === "Property Reset") out.push("Take the whole area back to clean: everything unwanted comes out.");
  if (pick(v, "overgrowth")) out.push("Cut back all the overgrowth.");
  if (pick(v, "vines")) out.push("Pull the vines down and out, roots and all.");
  if (pick(v, "saplings")) out.push("Dig out the small saplings, roots and all.");
  out.push("Pull every weed, roots and all.");
  const staying = text(v, "plantsStaying");
  if (staying) out.push(`Leave these where they are: ${staying}.`);
  out.push(CLEAN_UP);
  return out;
}

function leafCleanup(v: Values): string[] {
  const type = pick(v, "type");
  const out: string[] = [];
  if (type !== "Fall Cutback") out.push("Rake and blow out every leaf: the lawn, the beds, the corners, behind the shrubs and along the fences.");
  if (type === "Fall Cutback" || type === "Full Fall Cleanup") {
    const which = text(v, "grassesToCutBack");
    out.push(which ? `Cut back ${lower(which)}.` : "Cut back the ornamental grasses and perennials.");
  }
  if (pick(v, "leafVolume") === "Heavy" || pick(v, "leafVolume") === "Extreme") out.push("It's a heavy load: bring the tarps and plan for more than one haul.");
  out.push(CLEAN_UP);
  return out;
}

function lawnRestoration(v: Values): string[] {
  const out = ["Rake out the dead grass and loosen the top of the soil."];
  if (pick(v, "condition") === "Landscape-to-Lawn Conversion") out.unshift("Take out everything in the old bed: mulch or stone, fabric and roots.");
  if (pick(v, "soilCondition") === "Needs Topsoil") out.push("Spread topsoil across it.");
  if (pick(v, "grade") === "Needs Correction") out.push("Regrade it so it's even and runs away from the house.");
  out.push("Spread the seed evenly, rake it in, and cover it with straw.");
  out.push(CLEAN_UP);
  return out;
}

function lawnCare(v: Values): string[] {
  const what = pick(v, "serviceType");
  const out: string[] = [];
  if (what === "Fertilization") out.push("Spread the fertilizer evenly across the lawn.");
  else if (what === "Weed Control") out.push("Spray the weeds in the lawn, following the label.");
  else if (what === "Aeration") out.push("Core aerate the whole lawn.");
  else if (what === "Overseeding") out.push("Seed the thin and bare spots.");
  else if (what === "Edging") out.push("Edge along every walk, drive and bed.");
  else out.push("Mow, edge along every walk, drive and bed, and string trim what the mower can't reach.");
  const special = text(v, "specialInstructions");
  if (special) out.push(`${special}.`);
  out.push("Blow the clippings off the walks, driveway and beds.");
  return out;
}

function grading(v: Values): string[] {
  const out = ["Regrade the area so it's even."];
  const direction = text(v, "waterDirection");
  if (direction) out.push(`Water needs to run ${lower(direction)}.`);
  else if (pick(v, "purpose") === "Drainage") out.push("Slope it so water runs away from the house.");
  out.push("Tamp it firm, then rake the top smooth.");
  out.push(CLEAN_UP);
  return out;
}

function softWashing(v: Values): string[] {
  const surface = pick(v, "surface");
  const out = [`Soft wash the ${surface ? lower(surface) : "surface"}${text(v, "materialType") ? ` (${text(v, "materialType")})` : ""}.`];
  const stains = text(v, "stainingAreas");
  if (stains) out.push(`Give these extra attention: ${stains}.`);
  out.push("Rinse everything around it, plants included.");
  return out;
}

const BY_TYPE: Record<string, (v: Values) => string[]> = {
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

/** One line per thing to do in the area, in order. */
export function crewInstructions(typeId: string, values: Values): string[] {
  const build = BY_TYPE[typeId];
  if (build) return build(values);
  // A service we have no words for yet: say what was noted, plainly.
  return Object.entries(values)
    .filter(([key, value]) => value && !key.includes("__"))
    .map(([, value]) => `${value}.`);
}
