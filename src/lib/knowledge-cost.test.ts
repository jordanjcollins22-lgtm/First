import { describe, expect, it } from "vitest";

import {
  UNITS,
  costOf,
  defaultCostBasis,
  costOfMany,
  describeQuantity,
  hours,
  isTimeUnit,
  money,
  shortages,
  suggestedQuantity,
  unitDef,
} from "@/lib/knowledge-cost";
import type { Graph, GraphEdge, GraphNode, RelationshipType } from "@/lib/knowledge-graph";

function node(
  id: string,
  title: string,
  nodeType: GraphNode["nodeType"] = "idea",
  cost: number | null = null,
  unit = "each"
): GraphNode {
  return {
    id,
    title,
    nodeType,
    status: "idea",
    description: null,
    importance: null,
    estimatedCost: cost,
    unit,
    purchaseUrl: null,
    costBasis: null,
    unitHours: null,
    outputPerUnit: null,
    outputUnit: null,
    runSize: null,
    runUnit: null,
    fixedCost: null,
    isFee: false,
    durationHours: null,
    hourlyRate: null,
    materialId: null,
    toolId: null,
    materialName: null,
    stockOnHand: null,
    reorderThreshold: null,
    onOrder: false,
    potentialValue: null,
    notes: null,
    tags: [],
    positionX: null,
    positionY: null,
    scheduledFor: null,
    recurrence: "none",
    recurrenceInterval: 1,
    lastDoneAt: null,
    timesDone: 0,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  quantity: number | null = null,
  relationshipType: RelationshipType = "requires"
): GraphEdge {
  return { id, sourceId, targetId, relationshipType, strength: 3, quantity, notes: null };
}

// The user's own example, priced: two thousand door hangers on cardstock,
// a toner cartridge, and four hours of somebody's design time.
const PRINT: Graph = {
  nodes: [
    node("hangers", "Door hangers"),
    node("card", "Cardstock", "material", 0.12, "sheet"),
    node("toner", "Toner", "material", 89, "each"),
    node("design", "Design time", "skill", 45, "hour"),
  ],
  edges: [
    edge("e1", "hangers", "card", 2000, "requires_material"),
    edge("e2", "hangers", "toner", 1, "requires_material"),
    edge("e3", "hangers", "design", 4, "requires_skill"),
  ],
};

describe("costOf", () => {
  it("adds materials up from the price of one unit", () => {
    const cost = costOf(PRINT, "hangers");
    // 2,000 sheets at 12c, plus one 89-dollar cartridge.
    expect(cost.materials).toBeCloseTo(329, 5);
  });

  it("keeps time apart from materials", () => {
    const cost = costOf(PRINT, "hangers");
    expect(cost.labour).toBe(180);
    expect(cost.hours).toBe(4);
    expect(cost.total).toBeCloseTo(509, 5);
  });

  it("returns nothing for a node with no requirements", () => {
    expect(costOf(PRINT, "card").total).toBe(0);
  });

  it("returns nothing for a node that isn't there", () => {
    expect(costOf(PRINT, "missing").total).toBe(0);
  });

  it("does not charge a resource for the things that use it", () => {
    // Walking backwards would make the cardstock cost what the door hangers
    // cost, which is the opposite of true.
    expect(costOf(PRINT, "toner").total).toBe(0);
  });

  it("counts an unpriced input once rather than as free", () => {
    const graph: Graph = {
      nodes: [node("idea", "Yard signs"), node("signs", "Corrugated signs", "material")],
      edges: [edge("e", "idea", "signs", 50)],
    };
    const cost = costOf(graph, "idea");
    expect(cost.total).toBe(0);
    expect(cost.unpriced.map((n) => n.title)).toEqual(["Corrugated signs"]);
  });

  it("treats a missing quantity as one", () => {
    const graph: Graph = {
      nodes: [node("idea", "Signage"), node("sign", "Sign", "material", 30)],
      edges: [edge("e", "idea", "sign", null)],
    };
    expect(costOf(graph, "idea").total).toBe(30);
  });

  it("ignores connections that are not about being made of something", () => {
    const graph: Graph = {
      nodes: [node("a", "Door hangers"), node("b", "Flyers", "idea", 500)],
      edges: [edge("e", "a", "b", 1, "similar_to")],
    };
    // Resembling an expensive idea does not cost anything.
    expect(costOf(graph, "a").total).toBe(0);
  });

  it("goes down through a layer of decomposition", () => {
    // Door hangers require a print run; the print run is what needs paper.
    const layered: Graph = {
      nodes: [
        node("hangers", "Door hangers"),
        node("run", "Print run", "process"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
      ],
      edges: [edge("e1", "hangers", "run", 2), edge("e2", "run", "card", 1000)],
    };
    // Two runs of a thousand sheets at ten cents.
    expect(costOf(layered, "hangers").materials).toBeCloseTo(200, 5);
  });

  it("stops at the depth limit rather than running away", () => {
    const chain: Graph = {
      nodes: [
        node("a", "A"),
        node("b", "B", "process"),
        node("c", "C", "process"),
        node("d", "D", "material", 10),
      ],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d")],
    };
    expect(costOf(chain, "a", 4).total).toBe(10);
    expect(costOf(chain, "a", 1).total).toBe(0);
  });

  it("survives a cycle", () => {
    const cyclic: Graph = {
      nodes: [node("a", "A"), node("b", "B", "process", 5)],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "a")],
    };
    expect(() => costOf(cyclic, "a")).not.toThrow();
    expect(costOf(cyclic, "a").total).toBe(5);
  });

  it("lists what it charged for, deepest last", () => {
    const cost = costOf(PRINT, "hangers");
    expect(cost.lines).toHaveLength(3);
    expect(cost.lines.every((l) => l.depth === 0)).toBe(true);
    expect(cost.lines.find((l) => l.node.title === "Cardstock")?.amount).toBeCloseTo(240, 5);
  });
});

describe("costOfMany", () => {
  it("adds up a week of work", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Door hangers"),
        node("b", "Flyers"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
      ],
      edges: [edge("e1", "a", "card", 1000), edge("e2", "b", "card", 500)],
    };
    // Fifteen hundred sheets, because both runs need their own paper —
    // sharing the printer does not share the paper.
    expect(costOfMany(graph, ["a", "b"]).materials).toBeCloseTo(150, 5);
  });

  it("reports each unpriced input once, however many ideas need it", () => {
    const graph: Graph = {
      nodes: [node("a", "A"), node("b", "B"), node("x", "Unpriced thing", "material")],
      edges: [edge("e1", "a", "x", 1), edge("e2", "b", "x", 1)],
    };
    expect(costOfMany(graph, ["a", "b"]).unpriced).toHaveLength(1);
  });

  it("is zero for nothing at all", () => {
    expect(costOfMany(PRINT, []).total).toBe(0);
  });
});

describe("units", () => {
  it("calls hours, days and weeks time and nothing else", () => {
    expect(isTimeUnit("hour")).toBe(true);
    expect(isTimeUnit("day")).toBe(true);
    expect(isTimeUnit("week")).toBe(true);
    // A monthly bill is money, not somebody's afternoon.
    expect(isTimeUnit("month")).toBe(false);
    expect(isTimeUnit("sheet")).toBe(false);
  });

  it("falls back to each for anything unrecognised", () => {
    expect(unitDef("nonsense").value).toBe("each");
  });

  it("converts days into hours when adding time up", () => {
    const graph: Graph = {
      nodes: [node("a", "Clean-up week"), node("crew", "Crew day", "role", 400, "day")],
      edges: [edge("e", "a", "crew", 3)],
    };
    const cost = costOf(graph, "a");
    expect(cost.hours).toBe(24);
    expect(cost.labour).toBe(1200);
  });

  it("has no duplicate unit values", () => {
    expect(new Set(UNITS.map((u) => u.value)).size).toBe(UNITS.length);
  });
});

describe("wording", () => {
  it("writes money without false precision", () => {
    expect(money(509)).toBe("$509");
    expect(money(1250)).toBe("$1,250");
    expect(money(12.5)).toBe("$12.50");
  });

  it("writes time the way somebody says it", () => {
    expect(hours(0)).toBe("0 hrs");
    expect(hours(1)).toBe("1 hr");
    expect(hours(4)).toBe("4 hrs");
    expect(hours(1.5)).toBe("1.5 hrs");
    expect(hours(24)).toBe("3 days");
  });

  it("writes a quantity with its unit", () => {
    expect(describeQuantity(2000, "sheet")).toBe("2000 sheets");
    expect(describeQuantity(4, "hour")).toBe("4 hours");
    expect(describeQuantity(1, "box")).toBe("1 box");
    expect(describeQuantity(1, "each")).toBe("1");
    // An abbreviation does not take an "s".
    expect(describeQuantity(3, "sq ft")).toBe("3 sq ft");
    expect(describeQuantity(12, "ft")).toBe("12 feet");
  });
});

describe("capital versus running cost", () => {
  // A printer is not a cost of printing. It is a cost of being able to print.
  const withPrinter: Graph = {
    nodes: [
      node("hangers", "Door hangers"),
      node("flyers", "Flyers"),
      node("printer", "Colour printer", "equipment", 420),
      node("card", "Cardstock", "material", 0.1, "sheet"),
    ],
    edges: [
      edge("e1", "hangers", "printer", 1, "requires_equipment"),
      edge("e2", "hangers", "card", 1000, "requires_material"),
      edge("e3", "flyers", "printer", 1, "requires_equipment"),
      edge("e4", "flyers", "card", 500, "requires_material"),
    ],
  };

  it("keeps kit out of what a run costs", () => {
    const cost = costOf(withPrinter, "hangers");
    expect(cost.materials).toBeCloseTo(100, 5);
    expect(cost.total).toBeCloseTo(100, 5);
    expect(cost.capital).toBe(420);
    expect(cost.capitalItems.map((n) => n.title)).toEqual(["Colour printer"]);
  });

  it("charges a shared printer once across a whole schedule, not once each", () => {
    // The entire point of spotting a shared resource is that it is one
    // purchase. Counting it twice would contradict the panel above it.
    const cost = costOfMany(withPrinter, ["hangers", "flyers"]);
    expect(cost.capital).toBe(420);
    expect(cost.materials).toBeCloseTo(150, 5);
  });

  it("does not multiply kit by how much of it a connection claims", () => {
    const graph: Graph = {
      nodes: [node("a", "Big print run"), node("p", "Printer", "equipment", 420)],
      edges: [edge("e", "a", "p", 5)],
    };
    expect(costOf(graph, "a").capital).toBe(420);
  });

  it("still treats consumables as consumed", () => {
    // Toner runs out. It is a material, and it is charged per run.
    const graph: Graph = {
      nodes: [node("a", "Print run"), node("t", "Toner", "material", 89)],
      edges: [edge("e", "a", "t", 2)],
    };
    expect(costOf(graph, "a").materials).toBe(178);
    expect(costOf(graph, "a").capital).toBe(0);
  });

  it("counts software as kit rather than as time", () => {
    const graph: Graph = {
      nodes: [node("a", "Design work"), node("s", "Design software", "software", 30, "month")],
      edges: [edge("e", "a", "s", 1)],
    };
    const cost = costOf(graph, "a");
    expect(cost.capital).toBe(30);
    expect(cost.hours).toBe(0);
  });
});

describe("cost basis said out loud", () => {
  it("charges a material marked as kept only once", () => {
    // A sign frame is filed as a material and goes back in the truck. Charged
    // to every campaign it would overstate all of them.
    const graph: Graph = {
      nodes: [
        node("a", "Spring campaign"),
        node("b", "Autumn campaign"),
        { ...node("frame", "Sign frame", "material", 60), costBasis: "capital" as const },
      ],
      edges: [edge("e1", "a", "frame", 4), edge("e2", "b", "frame", 4)],
    };

    expect(costOf(graph, "a").materials).toBe(0);
    expect(costOf(graph, "a").capital).toBe(60);
    expect(costOfMany(graph, ["a", "b"]).capital).toBe(60);
  });

  it("charges a tool marked as used up every run", () => {
    // Blades and bits are filed with the tools and get consumed.
    const graph: Graph = {
      nodes: [
        node("a", "Edging day"),
        { ...node("blade", "Trimmer line", "tool", 12), costBasis: "consumable" as const },
      ],
      edges: [edge("e", "a", "blade", 3)],
    };

    expect(costOf(graph, "a").materials).toBe(36);
    expect(costOf(graph, "a").capital).toBe(0);
  });

  it("falls back to the kind of thing when nobody has said", () => {
    const graph: Graph = {
      nodes: [node("a", "Print run"), node("p", "Printer", "equipment", 420)],
      edges: [edge("e", "a", "p", 1)],
    };
    expect(costOf(graph, "a").capital).toBe(420);
  });

  it("suggests the basis the kind of thing implies", () => {
    expect(defaultCostBasis("equipment")).toBe("capital");
    expect(defaultCostBasis("tool")).toBe("capital");
    expect(defaultCostBasis("software")).toBe("capital");
    expect(defaultCostBasis("material")).toBe("consumable");
    expect(defaultCostBasis("skill")).toBe("consumable");
  });
});

describe("money that goes to somebody else", () => {
  // A mailing house charges a flat four-fifty a drop whether the drop is two
  // thousand pieces or three.
  const withFee: Graph = {
    nodes: [
      node("hangers", "Door hangers"),
      node("flyers", "Flyers"),
      { ...node("mail", "Mailing house", "supplier"), fixedCost: 450 },
      node("card", "Cardstock", "material", 0.1, "sheet"),
    ],
    edges: [
      edge("e1", "hangers", "mail", 1),
      edge("e2", "hangers", "card", 1000),
      edge("e3", "flyers", "mail", 1),
    ],
  };

  it("charges the fee flat, not per unit", () => {
    const graph: Graph = {
      nodes: [node("a", "Big drop"), { ...node("mail", "Mailing house", "supplier"), fixedCost: 450 }],
      // Three thousand pieces through the same one drop.
      edges: [edge("e", "a", "mail", 3000)],
    };
    expect(costOf(graph, "a").services).toBe(450);
  });

  it("keeps it out of materials and out of hours", () => {
    const cost = costOf(withFee, "hangers");
    expect(cost.materials).toBeCloseTo(100, 5);
    expect(cost.hours).toBe(0);
    expect(cost.services).toBe(450);
    expect(cost.serviceItems.map((n) => n.title)).toEqual(["Mailing house"]);
  });

  it("counts it in what the run costs", () => {
    expect(costOf(withFee, "hangers").total).toBeCloseTo(550, 5);
  });

  it("pays it once per run however many parts need them", () => {
    const layered: Graph = {
      nodes: [
        node("a", "Campaign"),
        node("run1", "Hanger drop", "process"),
        node("run2", "Flyer drop", "process"),
        { ...node("mail", "Mailing house", "supplier"), fixedCost: 450 },
      ],
      edges: [
        edge("e1", "a", "run1"),
        edge("e2", "a", "run2"),
        edge("e3", "run1", "mail"),
        edge("e4", "run2", "mail"),
      ],
    };
    expect(costOf(layered, "a").services).toBe(450);
  });

  it("pays it again for a second campaign", () => {
    // The opposite of kit: two drops are two invoices.
    expect(costOfMany(withFee, ["hangers", "flyers"]).services).toBe(900);
  });

  it("does not call a priced fee an unpriced input", () => {
    expect(costOf(withFee, "hangers").unpriced).toHaveLength(0);
  });

  it("beats the kind of thing it is", () => {
    // A subcontractor filed as equipment is still an invoice, not a purchase
    // that keeps earning.
    const graph: Graph = {
      nodes: [node("a", "Job"), { ...node("sub", "Sub crew", "equipment", 900), fixedCost: 1200 }],
      edges: [edge("e", "a", "sub", 1)],
    };
    expect(costOf(graph, "a").capital).toBe(0);
    expect(costOf(graph, "a").services).toBe(1200);
  });
});

describe("units this business typed itself", () => {
  it("counts a made-up unit as time when they said it is", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Clean-up"),
        { ...node("shift", "Crew shift", "role", 320, "shift"), unitHours: 6 },
      ],
      edges: [edge("e", "a", "shift", 2)],
    };
    const cost = costOf(graph, "a");
    expect(cost.hours).toBe(12);
    expect(cost.labour).toBe(640);
    expect(cost.materials).toBe(0);
  });

  it("treats a made-up unit as a thing when they did not", () => {
    const graph: Graph = {
      nodes: [node("a", "Sod job"), node("pallet", "Sod", "material", 180, "pallet")],
      edges: [edge("e", "a", "pallet", 3)],
    };
    const cost = costOf(graph, "a");
    expect(cost.materials).toBe(540);
    expect(cost.hours).toBe(0);
  });
});

describe("suggestedQuantity", () => {
  const idea = (runSize: number | null, runUnit: string | null) => ({
    ...node("i", "Door hangers"),
    runSize,
    runUnit,
  });
  const input = (outputPerUnit: number | null, outputUnit: string | null) => ({
    ...node("m", "Cardstock", "material", 0.12, "sheet"),
    outputPerUnit,
    outputUnit,
  });

  it("divides the run by what one of them does", () => {
    expect(suggestedQuantity(idea(2000, "hangers"), input(1, "hangers"))).toBe(2000);
  });

  it("rounds up, because nine and a bit bags is ten bags", () => {
    expect(suggestedQuantity(idea(1000, "sq ft"), input(100, "sq ft"))).toBe(10);
    expect(suggestedQuantity(idea(950, "sq ft"), input(100, "sq ft"))).toBe(10);
  });

  it("ignores case and stray spaces in the units", () => {
    expect(suggestedQuantity(idea(500, "Sq Ft"), input(100, " sq ft "))).toBe(5);
  });

  it("says nothing when the units do not line up", () => {
    // A number that looks calculated and is not is worse than no number.
    expect(suggestedQuantity(idea(2000, "hangers"), input(100, "sq ft"))).toBeNull();
  });

  it("says nothing when either half is missing", () => {
    expect(suggestedQuantity(idea(null, "hangers"), input(1, "hangers"))).toBeNull();
    expect(suggestedQuantity(idea(2000, "hangers"), input(null, "hangers"))).toBeNull();
    expect(suggestedQuantity(idea(2000, null), input(1, "hangers"))).toBeNull();
  });
});

describe("describeQuantity with a home-made unit", () => {
  it("uses the name somebody typed rather than falling back to each", () => {
    // "2,000 each" for two thousand pallets is worse than saying nothing.
    expect(describeQuantity(3, "pallet")).toBe("3 pallets");
    expect(describeQuantity(1, "pallet")).toBe("1 pallet");
  });

  it("does not add a second s to a name that already has one", () => {
    expect(describeQuantity(4, "bunches")).toBe("4 bunches");
  });

  it("still handles the built-in ones", () => {
    expect(describeQuantity(2000, "sheet")).toBe("2000 sheets");
    expect(describeQuantity(5, "each")).toBe("5");
  });
});

describe("time said on the thing itself", () => {
  it("counts its own hours and rate", () => {
    // A door hanger drop takes four hours because somebody walks it. There is
    // no inventory row to link to.
    const graph: Graph = {
      nodes: [{ ...node("drop", "Door hanger drop"), durationHours: 4, hourlyRate: 22 }],
      edges: [],
    };
    const cost = costOf(graph, "drop");
    expect(cost.hours).toBe(4);
    expect(cost.labour).toBe(88);
    expect(cost.total).toBe(88);
  });

  it("adds to hours linked by the hour rather than replacing them", () => {
    const graph: Graph = {
      nodes: [
        { ...node("drop", "Door hanger drop"), durationHours: 4, hourlyRate: 22 },
        node("design", "Design time", "skill", 45, "hour"),
      ],
      edges: [edge("e", "drop", "design", 2, "requires_skill")],
    };
    const cost = costOf(graph, "drop");
    expect(cost.hours).toBe(6);
    expect(cost.labour).toBe(88 + 90);
  });

  it("counts the hours even with no rate on them", () => {
    // Knowing it takes four hours is what the calendar needs, whether or not
    // anybody has priced an hour.
    const graph: Graph = {
      nodes: [{ ...node("drop", "Drop"), durationHours: 4 }],
      edges: [],
    };
    expect(costOf(graph, "drop").hours).toBe(4);
    expect(costOf(graph, "drop").labour).toBe(0);
  });

  it("is nothing when nobody has said how long", () => {
    expect(costOf({ nodes: [node("a", "A")], edges: [] }, "a").hours).toBe(0);
  });
});

describe("shortages", () => {
  const stocked = (id: string, title: string, cost: number, unit: string, onHand: number) => ({
    ...node(id, title, "material", cost, unit),
    materialId: `mat-${id}`,
    stockOnHand: onHand,
  });

  it("says what there is not enough of", () => {
    const graph: Graph = {
      nodes: [node("run", "Flyer run"), stocked("card", "Cardstock", 0.12, "sheet", 400)],
      edges: [edge("e", "run", "card", 2500, "requires_material")],
    };
    const [short] = shortages(graph, "run");
    expect(short.node.title).toBe("Cardstock");
    expect(short.needed).toBe(2500);
    expect(short.onHand).toBe(400);
    expect(short.short).toBe(2100);
  });

  it("says nothing when there is enough", () => {
    const graph: Graph = {
      nodes: [node("run", "Flyer run"), stocked("card", "Cardstock", 0.12, "sheet", 5000)],
      edges: [edge("e", "run", "card", 2500, "requires_material")],
    };
    expect(shortages(graph, "run")).toHaveLength(0);
  });

  it("adds up the same material reached by two routes", () => {
    const graph: Graph = {
      nodes: [
        node("campaign", "Campaign"),
        node("a", "Hanger drop", "process"),
        node("b", "Flyer drop", "process"),
        stocked("card", "Cardstock", 0.12, "sheet", 1000),
      ],
      edges: [
        edge("e1", "campaign", "a"),
        edge("e2", "campaign", "b"),
        edge("e3", "a", "card", 800, "requires_material"),
        edge("e4", "b", "card", 800, "requires_material"),
      ],
    };
    const [short] = shortages(graph, "campaign");
    expect(short.needed).toBe(1600);
    expect(short.short).toBe(600);
  });

  it("ignores anything with no stock figure — no row, no shortage", () => {
    const graph: Graph = {
      nodes: [node("run", "Run"), node("card", "Cardstock", "material", 0.12, "sheet")],
      edges: [edge("e", "run", "card", 9999, "requires_material")],
    };
    expect(shortages(graph, "run")).toHaveLength(0);
  });

  it("ignores kit — one printer does not run out by being used twice", () => {
    const graph: Graph = {
      nodes: [
        node("run", "Run"),
        { ...node("printer", "Printer", "equipment", 420), materialId: "t1", stockOnHand: 1 },
      ],
      edges: [edge("e", "run", "printer", 5, "requires_equipment")],
    };
    expect(shortages(graph, "run")).toHaveLength(0);
  });
});

describe("a third-party cost charged per piece", () => {
  // EDDM postage is 25c a piece. Twenty-five cents was showing as the whole
  // bill because "somebody else's money" and "priced once a run" had been
  // treated as the same thing.
  const postage = (): Graph => ({
    nodes: [
      node("flyers", "Flyers"),
      { ...node("eddm", "EDDM postage", "service", 0.25, "each"), isFee: true },
    ],
    edges: [edge("e", "flyers", "eddm", 2500, "requires")],
  });

  it("multiplies by the quantity", () => {
    expect(costOf(postage(), "flyers").services).toBeCloseTo(625, 5);
  });

  it("still counts as money paid out, not as materials", () => {
    const cost = costOf(postage(), "flyers");
    expect(cost.materials).toBe(0);
    expect(cost.hours).toBe(0);
    expect(cost.total).toBeCloseTo(625, 5);
  });

  it("keeps a genuinely flat fee flat", () => {
    const graph: Graph = {
      nodes: [
        node("flyers", "Flyers"),
        { ...node("permit", "Permit", "service"), fixedCost: 90, isFee: true },
      ],
      edges: [edge("e", "flyers", "permit", 2500, "requires")],
    };
    expect(costOf(graph, "flyers").services).toBe(90);
  });

  it("adds a per-piece cost up across every route, unlike a flat one", () => {
    const graph: Graph = {
      nodes: [
        node("campaign", "Campaign"),
        node("a", "Drop one", "process"),
        node("b", "Drop two", "process"),
        { ...node("eddm", "EDDM postage", "service", 0.25, "each"), isFee: true },
      ],
      edges: [
        edge("e1", "campaign", "a"),
        edge("e2", "campaign", "b"),
        edge("e3", "a", "eddm", 1000, "requires"),
        edge("e4", "b", "eddm", 1000, "requires"),
      ],
    };
    expect(costOf(graph, "campaign").services).toBeCloseTo(500, 5);
  });
});
