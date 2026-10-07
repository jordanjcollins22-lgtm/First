/**
 * The client's plan, written back to them the way a proposal reads: for
 * each service they picked, what we will do, in the order we do it. Prep,
 * then the work, then the clean up.
 *
 * Every bed and every lawn gets full prep, whatever they picked, so the
 * prep is always written out. What they told us changes the rest: stone in
 * a bed that is getting mulch means the stone comes out first; a new bed
 * cut into the lawn means the grass comes out; and so on.
 *
 * It is what they asked for, not a quote. The evaluator confirms it on the
 * visit, and the proposal is what they agree to.
 *
 * Pure, so each rule is tested without the form.
 */

import { DETAIL_QUESTIONS, INTAKE_QUESTIONS, labelOf, type IntakeAnswers } from "@/lib/evaluation-intake";

export interface PlanSection {
  heading: "Prep" | "The work" | "Clean up" | "You told us";
  items: string[];
}

export interface PlanService {
  service: string;
  heading: string;
  sections: PlanSection[];
}

const HEADINGS: Record<string, string> = {
  beds: "Beds",
  lawn: "Lawn",
  cleanup: "Cleanup and trimming",
  removal: "Shrub and plant removal",
  drainage: "Drainage",
  hardscape: "Patio, walkway or wall",
  washing: "Soft washing",
  holiday: "Holiday decorations",
  snow: "Snow removal",
  other: "Something else",
};

/** "a, b and c". */
function list(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function sections(prep: string[], work: string[], cleanup: string[], told: string[] = []): PlanSection[] {
  const all: PlanSection[] = [
    { heading: "Prep", items: prep },
    { heading: "The work", items: work },
    { heading: "Clean up", items: cleanup },
    { heading: "You told us", items: told },
  ];
  return all.filter((s) => s.items.length > 0);
}

export function projectPlan(answers: IntakeAnswers): PlanService[] {
  const picked = (id: string): string[] => {
    const v = answers.details[id];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const one = (id: string): string => picked(id)[0] ?? "";
  const has = (id: string, value: string) => picked(id).includes(value);
  const lower = (id: string, value: string) => {
    const q = DETAIL_QUESTIONS.find((d) => d.id === id)!;
    return labelOf(q, value).toLowerCase();
  };
  /** Anything they wrote in a question's box about this service. */
  const notes = (...ids: string[]) =>
    ids.map((id) => answers.details[`${id}_notes`]).filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => `"${n.trim()}"`);

  return answers.services.map((service): PlanService => {
    const heading = HEADINGS[service] ?? service;
    switch (service) {
      case "beds":
        return { service, heading, sections: beds() };
      case "lawn":
        return { service, heading, sections: lawn() };
      case "cleanup":
        return { service, heading, sections: cleanup() };
      case "removal":
        return { service, heading, sections: removal() };
      case "drainage":
        return { service, heading, sections: drainage() };
      case "hardscape":
        return { service, heading, sections: hardscape() };
      case "washing":
        return { service, heading, sections: washing() };
      case "holiday":
        return { service, heading, sections: holiday() };
      case "snow":
        return {
          service,
          heading,
          sections: sections([], ["Clear the driveway and walk after each storm, down to the pavement, and treat them for ice"], []),
        };
      default:
        return {
          service,
          heading,
          sections: sections(
            [],
            ["We look at it with you on the visit and write it up, priced, in your proposal"],
            [],
            answers.services_other ? [`"${answers.services_other}"`] : []
          ),
        };
    }
  });

  function beds(): PlanSection[] {
    const now = picked("beds_now");
    const mulch = has("beds_add", "mulch");
    const stone = has("beds_add", "stone");
    const plants = has("beds_add", "plants");

    // What is there now comes out when something different goes in.
    const prep: string[] = [];
    if (now.includes("stone") && mulch && !stone) prep.push("Remove all the old stone and rock and haul it away, so the mulch goes onto clean soil");
    if (now.includes("old_mulch") && stone && !mulch) prep.push("Remove all the old mulch down to the soil and haul it away, so the rock sits on a clean bed");
    if (now.includes("old_mulch") && mulch) prep.push("Rake out and turn the old mulch, so the new layer does not build up too deep");
    if (now.includes("stone") && stone) prep.push("Clean the leaves and dirt out of the rock that stays");
    if (now.includes("lawn")) prep.push("Cut the grass out where the new bed goes, roots and all, and shape the bed");
    prep.push(
      now.includes("weeds") ? "Pull every weed and all the grass out of the beds, roots and all" : "Pull every weed, roots and all",
      "Cut a clean, crisp edge along every bed",
      "Rake out old debris and level the beds"
    );

    const work: string[] = [];
    if (plants) {
      const looks = INTAKE_QUESTIONS.find((q) => q.key === "looks")!;
      const liked = answers.looks.filter((v) => v !== "unsure").map((v) => labelOf(looks, v).toLowerCase());
      work.push(
        liked.length
          ? `Plant new plants picked with you, in the looks you like: ${list(liked)}`
          : "Plant new plants picked with you. We bring options to the visit"
      );
      work.push("Set each plant level, water it in, and keep mulch pulled back off the stems");
    }
    if (mulch) {
      const colour = one("mulch_color");
      const which = colour && colour !== "unsure" ? `${lower("mulch_color", colour)} mulch` : "mulch, in the colour you pick on the visit";
      work.push(`Spread fresh ${which} evenly, 2 to 3 inches deep, pulled back off stems, trunks and the house`);
    }
    if (stone) {
      const size = one("bed_stone");
      const which = size && size !== "unsure" ? `${lower("bed_stone", size)} river rock` : "river rock, in the size you pick on the visit";
      work.push(`Lay ${which} evenly across the beds`);
    }
    if (has("beds_add", "edging")) work.push("Put in edging to hold a clean line between the beds and the lawn");
    if (has("beds_add", "unsure") || work.length === 0) work.push("Walk the beds with you and suggest what goes in them");

    return sections(
      prep,
      work,
      ["Blow the grass, walks and driveway clean", "Haul away every weed and all the debris"],
      notes("beds_now", "beds_add", "mulch_color", "bed_stone")
    );
  }

  function lawn(): PlanSection[] {
    const need = picked("lawn_need");
    const method = one("lawn_method");
    const repair = need.includes("patch") || need.includes("redo");
    const prep: string[] = ["Clear sticks, stones and debris off the lawn"];
    if (need.includes("redo")) prep.push("Strip the old lawn and loosen the soil across the whole area");
    else if (need.includes("patch")) prep.push("Rake out the dead grass in the bare and thin spots and loosen the soil");
    if (need.includes("level")) prep.push("Fill the low spots and take down the bumps with topsoil, so the lawn is level");
    if (need.includes("redo")) prep.push("Grade the soil smooth so it drains away from the house");

    const work: string[] = [];
    const where = need.includes("redo") ? "the whole lawn" : "the bare and thin spots";
    if (repair) {
      if (method === "sod") work.push(`Lay fresh sod over ${where}, seams tight, rolled and watered in`);
      else if (method === "seed") work.push(`Seed ${where}, covered with straw and watered in. It fills in over the season`);
      else work.push(`Sod or seed ${where}. We go over which suits your yard on the visit`);
    }
    if (need.includes("weeds")) work.push("Get the weeds out of the lawn. We go over the best way for your yard on the visit");
    if (need.includes("mowing")) work.push("Regular mowing, with the edges trimmed and the clippings blown off the walks and driveway every cut");
    if (work.length === 0) work.push("Walk the lawn with you and say what it needs");

    return sections(prep, work, ["Blow the walks and driveway clean", "Haul away the old grass and debris"], notes("lawn_need", "lawn_method"));
  }

  function cleanup(): PlanSection[] {
    const what = picked("cleanup_what");
    const work: string[] = [];
    if (what.includes("leaves")) work.push("Blow and rake the leaves out of the lawn, the beds, the corners and behind the shrubs");
    if (what.includes("weeds")) work.push("Pull the weeds out of the beds, roots and all");
    if (what.includes("trim")) work.push(`Trim the shrubs and hedges into shape${what.includes("tall") ? ", including the ones over 6 ft" : ""}`);
    else if (what.includes("tall")) work.push("Trim the shrubs over 6 ft into shape");
    if (what.includes("vines")) work.push("Cut back the vines and ivy and pull them off the house, fences and shrubs");
    if (what.includes("saplings")) work.push("Pull the saplings and seedlings before they take root");
    if (what.includes("debris")) work.push("Load up the junk and haul it away");
    if (work.length === 0) work.push("Clean up the yard top to bottom: weeds, dead growth and debris");
    return sections(
      ["Pick up trash and large debris first", "Lay tarps under anything being cut"],
      work,
      ["Rake every clipping out of the beds and off the grass", "Blow the walks, patio and driveway clean", "Haul away everything that came out"],
      notes("cleanup_what")
    );
  }

  function removal(): PlanSection[] {
    const what = picked("remove_what");
    const shrubs = [what.includes("small") ? "the smaller shrubs" : "", what.includes("large") ? "the larger shrubs" : ""].filter(Boolean);
    const work: string[] = [];
    if (shrubs.length) work.push(`Cut down ${list(shrubs)} and dig out the root balls`);
    if (what.includes("bed")) work.push("Clear the whole bed of plants, roots and all");
    if (what.includes("roots")) work.push("Dig out the old roots");
    if (work.length === 0) work.push("Cut down and dig out the plants you want gone, roots and all");
    work.push("Fill the holes and level them");
    return sections(
      ["Mark exactly which plants come out with you before anything is cut"],
      work,
      ["Rake the spots clean", "Haul away every branch and root"],
      notes("remove_what")
    );
  }

  function drainage(): PlanSection[] {
    const water = picked("water");
    const work: string[] = [];
    if (water.includes("house") || water.includes("basement")) work.push("Move the water away from the house");
    if (water.includes("pools")) work.push("Fix the low spots where water sits in the yard");
    if (water.includes("washout")) work.push("Stop the water washing out the beds and mulch");
    work.push("The exact fix is set on the visit, once we see where the water comes from and where it can go");
    const told = water.includes("every_rain") ? ["It happens after every rain"] : water.includes("heavy_rain") ? ["It happens after heavy rain"] : [];
    return sections(["Find where the water comes from and where it runs"], work, ["Rake and seed any ground we disturb", "Haul away extra soil and debris"], [...told, ...notes("water")]);
  }

  function hardscape(): PlanSection[] {
    const what = picked("hard_what").map((v) => lower("hard_what", v));
    const material = one("hard_material");
    const inWhat = material && material !== "unsure" ? ` in ${lower("hard_material", material)}` : "";
    return sections(
      ["Lay out the shape and size with you before we dig", "Dig out to the depth it needs and lay a compacted gravel base"],
      [what.length ? `Build the ${list(what)}${inWhat}` : `Build what you have in mind${inWhat}`, "Set it level, with a slight pitch so rain runs off and away from the house"],
      ["Backfill and tidy the ground around the edges", "Haul away the dirt and debris"],
      notes("hard_what", "hard_material")
    );
  }

  function washing(): PlanSection[] {
    const what = picked("wash_what").map((v) => lower("wash_what", v));
    const stories = one("stories");
    const house = stories ? ` on your ${stories === "3" ? "3 or more" : stories} story house` : "";
    return sections(
      ["Wet down the plants and grass around what we wash, and cover anything delicate"],
      [what.length ? `Soft wash the ${list(what)}${house}, with low pressure so nothing gets damaged` : "Soft wash what you want cleaned, with low pressure so nothing gets damaged"],
      ["Rinse the plants and grass off again when we finish"],
      notes("wash_what", "stories")
    );
  }

  function holiday(): PlanSection[] {
    const what = picked("holiday_what").map((v) => lower("holiday_what", v));
    const whose = one("holiday_lights");
    const told = whose === "ours" ? ["We bring the decorations"] : whose === "mine" ? ["We use your decorations"] : whose === "both" ? ["Some of your decorations, some of ours"] : [];
    return sections(
      [],
      [what.length ? `Put up the ${list(what)}` : "Decorate the way you want it"],
      ["Tidy up any clips, packaging and debris"],
      [...told, ...notes("holiday_what", "holiday_lights")]
    );
  }
}
