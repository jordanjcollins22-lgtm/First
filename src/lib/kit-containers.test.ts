import { describe, expect, it } from "vitest";

import {
  containerCost,
  containersForKit,
  containersValue,
  countOf,
  kitsLabel,
  needsAttention,
  parseKits,
  reorderList,
  storedInLabel,
  type ContainerPart,
  type KitContainer,
} from "@/lib/kit-containers";

function part(over: Partial<ContainerPart> = {}): ContainerPart {
  return {
    id: "p1",
    name: "Bungee",
    quantity: 1,
    cost: null,
    purchaseUrl: null,
    broken: 0,
    onOrder: false,
    notes: null,
    position: 0,
    ...over,
  };
}

function container(over: Partial<KitContainer> = {}): KitContainer {
  return {
    id: "c1",
    name: "Trash can dolly setup",
    kits: [1, 2, 3],
    kind: "built",
    quantity: 1,
    cost: null,
    purchaseUrl: null,
    broken: 0,
    onOrder: false,
    reorderThreshold: null,
    imagePath: null,
    notes: null,
    archivedAt: null,
    parts: [],
    ...over,
  };
}

describe("containersForKit", () => {
  it("finds the rig that carries several kits", () => {
    const dolly = container();
    const crate = container({ id: "c2", name: "DeWalt crate", kits: [4], kind: "bought" });
    expect(containersForKit([dolly, crate], 2)).toEqual([dolly]);
    expect(containersForKit([dolly, crate], 4)).toEqual([crate]);
  });

  it("finds both when a kit is split across two", () => {
    const a = container({ id: "a", name: "Dolly", kits: [1] });
    const b = container({ id: "b", name: "Crate", kits: [1] });
    expect(containersForKit([a, b], 1)).toHaveLength(2);
  });

  it("leaves an archived container out, so an old bin stops being an answer", () => {
    expect(containersForKit([container({ archivedAt: "2026-01-01T00:00:00Z" })], 1)).toEqual([]);
  });

  it("has nothing to say about the whole-inventory sheet", () => {
    expect(containersForKit([container()], null)).toEqual([]);
  });
});

describe("storedInLabel", () => {
  it("names the container", () => {
    expect(storedInLabel([container()], 2)).toBe("Trash can dolly setup");
  });

  it("names both when a kit is split", () => {
    const a = container({ id: "a", name: "Dolly", kits: [1] });
    const b = container({ id: "b", name: "Crate", kits: [1] });
    expect(storedInLabel([a, b], 1)).toBe("Dolly and Crate");
  });

  it("says nothing rather than spending a line saying nothing", () => {
    expect(storedInLabel([container()], 9)).toBeNull();
  });
});

describe("kitsLabel", () => {
  it("reads the way somebody would say it", () => {
    expect(kitsLabel([3, 1, 2])).toBe("Kits 1, 2 and 3");
    expect(kitsLabel([4])).toBe("Kit 4");
    expect(kitsLabel([])).toBe("No kit yet");
  });

  it("does not repeat a kit typed twice", () => {
    expect(kitsLabel([1, 1, 2])).toBe("Kits 1 and 2");
  });
});

describe("parseKits", () => {
  it("takes commas, spaces or both", () => {
    expect(parseKits("1, 2 3")).toEqual([1, 2, 3]);
    expect(parseKits("kits 1 and 2")).toEqual([1, 2]);
  });

  it("drops nonsense rather than inventing a kit zero", () => {
    expect(parseKits("0, -4, abc")).toEqual([4]);
    expect(parseKits("")).toEqual([]);
  });
});

describe("containerCost", () => {
  it("adds a built rig up from its parts, quantities counted", () => {
    const rig = container({
      parts: [
        part({ id: "a", name: "Trash can", cost: 30 }),
        part({ id: "b", name: "Dolly", cost: 45 }),
        part({ id: "c", name: "Bungee", cost: 4, quantity: 2 }),
      ],
    });
    expect(containerCost(rig)).toBe(83);
  });

  it("takes a bought container at its own price", () => {
    expect(containerCost(container({ kind: "bought", cost: 89, parts: [] }))).toBe(89);
  });

  it("gives nothing rather than zero when nobody has priced it", () => {
    expect(containerCost(container())).toBeNull();
  });
});

describe("containersValue", () => {
  it("counts how many of each we have", () => {
    const crate = container({ kind: "bought", cost: 89, quantity: 4, parts: [] });
    expect(containersValue([crate])).toBe(356);
  });

  it("leaves archived ones out of the total", () => {
    const crate = container({ kind: "bought", cost: 89, quantity: 1, archivedAt: "2026-01-01T00:00:00Z" });
    expect(containersValue([crate])).toBe(0);
  });
});

describe("countOf", () => {
  it("treats an unsaid quantity as one", () => {
    expect(countOf({ quantity: null })).toBe(1);
    expect(countOf({ quantity: 0 })).toBe(0);
  });
});

describe("reorderList", () => {
  it("puts a broken part on the list, not the whole rig", () => {
    const rig = container({
      parts: [part({ id: "b", name: "Dolly", broken: 1, cost: 45, purchaseUrl: "https://example.com/dolly" })],
    });
    const list = reorderList([rig]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Dolly");
    expect(list[0].reason).toBe("broken");
    expect(list[0].purchaseUrl).toBe("https://example.com/dolly");
  });

  it("says how many are broken rather than just that something is", () => {
    expect(reorderList([container({ kind: "bought", broken: 2 })])[0].count).toBe(2);
  });

  it("flags running low separately from broken", () => {
    const crate = container({ kind: "bought", quantity: 1, reorderThreshold: 2 });
    expect(reorderList([crate])[0].reason).toBe("running low");
  });

  it("does not nag about stock when the thing is broken, which is the bigger problem", () => {
    const crate = container({ kind: "bought", quantity: 1, reorderThreshold: 2, broken: 1 });
    const list = reorderList([crate]);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("broken");
  });

  it("keeps what is already ordered on the list, below what is not", () => {
    const ordered = container({ id: "a", name: "A crate", kind: "bought", broken: 1, onOrder: true });
    const not = container({ id: "b", name: "B crate", kind: "bought", broken: 1 });
    const list = reorderList([ordered, not]);
    expect(list.map((item) => item.containerId)).toEqual(["b", "a"]);
  });

  it("has nothing to say about an archived container", () => {
    expect(reorderList([container({ broken: 3, archivedAt: "2026-01-01T00:00:00Z" })])).toEqual([]);
  });
});

describe("needsAttention", () => {
  it("is quiet once the replacement is on order", () => {
    expect(needsAttention(container({ kind: "bought", broken: 1 }))).toBe(true);
    expect(needsAttention(container({ kind: "bought", broken: 1, onOrder: true }))).toBe(false);
  });
});
