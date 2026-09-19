import { describe, expect, it } from "vitest";

import { allLoaded, canLead, clampPage, loadPages, pageComplete } from "./shop-flow";
import type { Loadout, LoadoutItem } from "./loadout";

const item = (kind: LoadoutItem["kind"], key: string, checked = false): LoadoutItem => ({
  kind,
  key,
  label: kind === "kit" ? `Kit ${key}` : key,
  detail: kind === "kit" ? "Rakes, shovels" : null,
  forStops: ["Linda"],
  checked,
});
const loadout = (items: LoadoutItem[]): Loadout => ({ items, total: items.length, done: items.filter((i) => i.checked).length, complete: items.every((i) => i.checked) });

describe("loadPages", () => {
  it("is one page per kit, then the loose things together", () => {
    const pages = loadPages(loadout([item("kit", "1"), item("kit", "2", true), item("tool", "t1"), item("material", "mulch")]));
    expect(pages.map((p) => [p.key, p.items.length])).toEqual([
      ["kit:1", 1],
      ["kit:2", 1],
      ["loose", 2],
    ]);
    expect(pages[0].title).toBe("Load Kit 1");
    expect(pages[0].subtitle).toBe("Rakes, shovels. For Linda");
    expect(pageComplete(pages[1])).toBe(true);
    expect(allLoaded(pages)).toBe(false);
  });

  it("has no loose page when there is nothing loose", () => {
    expect(loadPages(loadout([item("kit", "3")])).map((p) => p.key)).toEqual(["kit:3"]);
    expect(loadPages(loadout([]))).toEqual([]);
    expect(allLoaded([])).toBe(true);
  });

  it("clamps the page index", () => {
    const pages = loadPages(loadout([item("kit", "1"), item("kit", "2")]));
    expect(clampPage(-1, pages)).toBe(0);
    expect(clampPage(5, pages)).toBe(1);
    expect(clampPage(0, [])).toBe(0);
  });
});

describe("canLead", () => {
  it("is the lead on a stop or somebody from the office", () => {
    expect(canLead({ roles: ["crew"], leadsAStop: true })).toBe(true);
    expect(canLead({ roles: ["crew"], leadsAStop: false })).toBe(false);
    expect(canLead({ roles: ["owner"], leadsAStop: false })).toBe(true);
    expect(canLead({ roles: ["project-lead"], leadsAStop: false })).toBe(true);
  });
});
