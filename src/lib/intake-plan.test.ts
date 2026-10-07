import { describe, expect, it } from "vitest";

import { cleanAnswers } from "./evaluation-intake";
import { projectPlan } from "./intake-plan";

const plan = (input: Record<string, unknown>) => projectPlan(cleanAnswers(input));
const section = (p: ReturnType<typeof plan>, service: string, heading: string) =>
  p.find((s) => s.service === service)?.sections.find((s) => s.heading === heading)?.items ?? [];

describe("the plan, written the way a proposal reads", () => {
  it("always writes out full prep on the beds, whatever they picked", () => {
    const prep = section(plan({ services: ["beds"] }), "beds", "Prep");
    expect(prep).toContain("Pull every weed, roots and all");
    expect(prep).toContain("Cut a clean, crisp edge along every bed");
    expect(prep).toContain("Rake out old debris and level the beds");
  });

  it("takes the stone out when the beds are changing to mulch", () => {
    const p = plan({ services: ["beds"], details: { beds_now: ["stone"], beds_add: ["mulch"], mulch_color: "black" } });
    expect(section(p, "beds", "Prep")[0]).toMatch(/Remove all the old stone and rock/);
    expect(section(p, "beds", "The work")[0]).toMatch(/^Spread fresh black mulch/);
  });

  it("takes the old mulch out when the beds are changing to rock", () => {
    const p = plan({ services: ["beds"], details: { beds_now: ["old_mulch"], beds_add: ["stone"], bed_stone: "medium" } });
    expect(section(p, "beds", "Prep")[0]).toMatch(/Remove all the old mulch/);
    expect(section(p, "beds", "The work")[0]).toBe("Lay medium river rock evenly across the beds");
  });

  it("cuts the grass out for a new bed, and plants in the looks they like", () => {
    const p = plan({ services: ["beds"], looks: ["classic"], details: { beds_now: ["lawn"], beds_add: ["plants"] } });
    expect(section(p, "beds", "Prep")[0]).toMatch(/Cut the grass out where the new bed goes/);
    expect(section(p, "beds", "The work")[0]).toMatch(/greens and whites, classic/);
  });

  it("leaves the colour or size to the visit when they are not sure", () => {
    const p = plan({ services: ["beds"], details: { beds_add: ["mulch", "stone"], mulch_color: "unsure" } });
    const work = section(p, "beds", "The work");
    expect(work[0]).toMatch(/colour you pick on the visit/);
    expect(work[1]).toMatch(/size you pick on the visit/);
  });

  it("writes the lawn from what it needs, sod or seed", () => {
    const p = plan({ services: ["lawn"], details: { lawn_need: ["redo", "level"], lawn_method: "sod" } });
    expect(section(p, "lawn", "Prep")).toContain("Strip the old lawn and loosen the soil across the whole area");
    expect(section(p, "lawn", "The work")[0]).toMatch(/^Lay fresh sod over the whole lawn/);
  });

  it("covers every service they picked, in their order, and quotes what they wrote", () => {
    const p = plan({ services: ["washing", "other"], services_other: "Fix the gate latch", details: { wash_what: ["siding", "deck"], stories: "2" } });
    expect(p.map((s) => s.heading)).toEqual(["Soft washing", "Something else"]);
    expect(section(p, "washing", "The work")[0]).toMatch(/house siding and deck on your 2 story house/);
    expect(section(p, "other", "You told us")).toEqual(['"Fix the gate latch"']);
  });

  it("promises nothing about trees or stumps", () => {
    const all = plan({ services: ["beds", "lawn", "cleanup", "removal", "drainage", "hardscape", "washing", "holiday", "snow"] });
    const text = all.flatMap((s) => s.sections.flatMap((x) => x.items)).join(" ");
    expect(text).not.toMatch(/\btree|stump/i);
    expect(text).not.toMatch(/[—–]/);
  });
});
