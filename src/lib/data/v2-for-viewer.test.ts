import { describe, expect, it } from "vitest";

import { v2ForViewer, type V2Pillar, type V2Section } from "./v2";

const part = (id: string, who: V2Pillar["who"]): V2Pillar => ({
  id, label: id, kind: "", who, title: id, sub: "", blocks: [{ v: "9", d: id }] as never, links: [{ label: id, href: `/${id}` }],
});

const page: V2Section = {
  key: "marketing", name: "Marketing", roles: [], groups: { a: { title: "", note: "" }, b: { title: "", note: "" } }, loadedAt: "",
  website: { draft: true } as never,
  pillars: [
    { ...part("digital", ["owner", "affiliate"]), blocks: [], links: [], parts: [part("roster", ["owner"]), part("mine", ["owner", "affiliate"])], panels: ["owner-thing"], rolePanels: { affiliate: ["affiliate-home"] } },
    { ...part("physical", ["owner"]), parts: [part("salt", ["owner"]), part("site", ["owner"])] },
  ],
};
page.pillars[1].parts![1].view = "website";

describe("v2ForViewer", () => {
  it("gives the owner the page untouched", () => {
    expect(v2ForViewer(page, ["owner"])).toBe(page);
  });

  it("sends a role only its own parts and home screens, nothing to hide in the browser", () => {
    const out = v2ForViewer(page, ["affiliate"]);
    expect(out.pillars.map((p) => p.id)).toEqual(["digital"]);
    expect(out.pillars[0].parts!.map((p) => p.id)).toEqual(["mine"]);
    expect(out.pillars[0].panels).toBeUndefined();
    expect(out.pillars[0].rolePanels).toEqual({ affiliate: ["affiliate-home"] });
    expect(out.website).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/roster|salt|owner-thing/);
  });
});
