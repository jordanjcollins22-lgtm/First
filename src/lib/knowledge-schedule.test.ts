import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  advance,
  daysBetween,
  describeDue,
  describeRecurrence,
  leverageInWindow,
  nextOccurrence,
  occurrencesBetween,
  scheduleBuckets,
} from "@/lib/knowledge-schedule";
import type { Graph, GraphEdge, GraphNode } from "@/lib/knowledge-graph";
import type { Recurrence } from "@/lib/knowledge-schedule";

function node(
  id: string,
  title: string,
  nodeType: GraphNode["nodeType"] = "idea",
  schedule?: { scheduledFor?: string; recurrence?: Recurrence; interval?: number }
): GraphNode {
  return {
    id,
    title,
    nodeType,
    status: "idea",
    isIssue: false,
    imagePath: null,
    description: null,
    importance: null,
    estimatedCost: null,
    unit: "each",
    purchaseUrl: null,
    appRoute: null,
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
    scheduledFor: schedule?.scheduledFor ?? null,
    recurrence: schedule?.recurrence ?? "none",
    recurrenceInterval: schedule?.interval ?? 1,
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
  quantity: number | null = null
): GraphEdge {
  return { id, sourceId, targetId, relationshipType: "requires", strength: 3, quantity, notes: null };
}

describe("date arithmetic", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("adds days across a year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("goes backwards too", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("clamps the end of the month rather than rolling over", () => {
    // The 31st plus a month is the end of February, not the 3rd of March.
    // Rolling over is how a monthly job silently skips a month.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("keeps the day where the month is long enough", () => {
    expect(addMonths("2026-01-15", 2)).toBe("2026-03-15");
  });

  it("counts days between two dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(-7);
  });
});

describe("advance", () => {
  const cases: [Recurrence, number, string][] = [
    ["daily", 1, "2026-03-02"],
    ["weekly", 1, "2026-03-08"],
    ["fortnightly", 1, "2026-03-15"],
    ["monthly", 1, "2026-04-01"],
    ["quarterly", 1, "2026-06-01"],
    ["yearly", 1, "2027-03-01"],
  ];

  it.each(cases)("steps %s forward", (recurrence, interval, expected) => {
    expect(advance("2026-03-01", recurrence, interval)).toBe(expected);
  });

  it("respects an interval", () => {
    expect(advance("2026-03-01", "weekly", 3)).toBe("2026-03-22");
    expect(advance("2026-03-01", "monthly", 2)).toBe("2026-05-01");
  });

  it("has no next for a one-off", () => {
    expect(advance("2026-03-01", "none")).toBeNull();
  });
});

describe("nextOccurrence", () => {
  it("rolls a missed weekly job forward to this week, not four misses ago", () => {
    // Scheduled a month back, never ticked off. The useful answer is the next
    // one, not a pile of four.
    expect(nextOccurrence("2026-03-02", "weekly", 1, "2026-03-25")).toBe("2026-03-30");
  });

  it("leaves a future date alone", () => {
    expect(nextOccurrence("2026-05-01", "monthly", 1, "2026-03-25")).toBe("2026-05-01");
  });

  it("returns the day itself when it is today", () => {
    expect(nextOccurrence("2026-03-25", "weekly", 1, "2026-03-25")).toBe("2026-03-25");
  });

  it("gives a one-off in the past no next date", () => {
    expect(nextOccurrence("2026-01-01", "none", 1, "2026-03-25")).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  it("lists every landing inside the window", () => {
    expect(occurrencesBetween("2026-03-02", "weekly", 1, "2026-03-01", "2026-03-31")).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ]);
  });

  it("skips a recurrence that has not started yet", () => {
    expect(occurrencesBetween("2026-06-01", "monthly", 1, "2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("still surfaces an overdue one-off", () => {
    // It was meant to happen and hasn't. Dropping it out of the window is how
    // something gets quietly forgotten.
    expect(occurrencesBetween("2026-02-01", "none", 1, "2026-03-01", "2026-03-31")).toEqual([
      "2026-02-01",
    ]);
  });
});

describe("scheduleBuckets", () => {
  const today = "2026-03-25";

  it("sorts work into overdue, today, soon and later", () => {
    const nodes = [
      node("a", "Overdue one-off", "idea", { scheduledFor: "2026-03-20" }),
      node("b", "Due today", "idea", { scheduledFor: today }),
      node("c", "This week", "idea", { scheduledFor: "2026-03-28" }),
      node("d", "Next month", "idea", { scheduledFor: "2026-04-30" }),
    ];

    const buckets = scheduleBuckets(nodes, today);
    expect(buckets.overdue.map((b) => b.node.id)).toEqual(["a"]);
    expect(buckets.today.map((b) => b.node.id)).toEqual(["b"]);
    expect(buckets.soon.map((b) => b.node.id)).toEqual(["c"]);
    expect(buckets.later.map((b) => b.node.id)).toEqual(["d"]);
  });

  it("does not call a recurring job overdue once it has come round again", () => {
    // Started weeks ago, recurs weekly. It is not four misses, it is a thing
    // that happens on Mondays.
    const monthly = node("m", "Door hangers", "idea", {
      scheduledFor: "2026-01-05",
      recurrence: "monthly",
    });
    const buckets = scheduleBuckets([monthly], today);
    expect(buckets.overdue).toHaveLength(0);
    // Eleven days out, so it is "later" rather than "this week" — but it is
    // the next one, not a backlog of three.
    expect(buckets.later.map((b) => b.due)).toEqual(["2026-04-05"]);
  });

  it("leaves unscheduled ideas out entirely", () => {
    const buckets = scheduleBuckets([node("x", "Just a thought")], today);
    expect(buckets.overdue.concat(buckets.today, buckets.soon, buckets.later)).toHaveLength(0);
  });

  it("ignores archived work", () => {
    const archived = { ...node("z", "Old campaign", "idea", { scheduledFor: today }), status: "archived" as const };
    expect(scheduleBuckets([archived], today).today).toHaveLength(0);
  });

  it("puts the earliest first", () => {
    const nodes = [
      node("late", "Later this week", "idea", { scheduledFor: "2026-03-30" }),
      node("early", "Tomorrow", "idea", { scheduledFor: "2026-03-26" }),
    ];
    expect(scheduleBuckets(nodes, today).soon.map((b) => b.node.id)).toEqual(["early", "late"]);
  });
});

describe("leverageInWindow", () => {
  const today = "2026-03-25";

  // The user's own example: three print jobs, one printer.
  const graph: Graph = {
    nodes: [
      node("hangers", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
      node("flyers", "Flyers", "idea", { scheduledFor: "2026-04-02" }),
      node("postcards", "Postcards", "idea", { scheduledFor: "2026-09-01" }),
      node("printer", "Colour printer", "equipment"),
      node("card", "Cardstock", "material"),
    ],
    edges: [
      edge("e1", "hangers", "printer"),
      edge("e2", "flyers", "printer"),
      edge("e3", "postcards", "printer"),
      edge("e4", "hangers", "card"),
    ],
  };

  it("finds what two scheduled ideas both need in the window", () => {
    const leverage = leverageInWindow(graph, today, 30);
    expect(leverage).toHaveLength(1);
    expect(leverage[0].resource.title).toBe("Colour printer");
    expect(leverage[0].uses.map((u) => u.node.title)).toEqual(["Door hangers", "Flyers"]);
  });

  it("leaves out work scheduled beyond the window", () => {
    // Postcards use the same printer but are six months out — batching them
    // with next week's run is not a real option.
    const leverage = leverageInWindow(graph, today, 30);
    expect(leverage[0].uses.some((u) => u.node.title === "Postcards")).toBe(false);
  });

  it("pulls the postcards in once the window is wide enough", () => {
    const leverage = leverageInWindow(graph, today, 400);
    expect(leverage[0].uses).toHaveLength(3);
  });

  it("ignores a resource only one scheduled idea needs", () => {
    const leverage = leverageInWindow(graph, today, 30);
    expect(leverage.some((l) => l.resource.title === "Cardstock")).toBe(false);
  });

  it("counts a recurring idea that lands inside the window", () => {
    const recurring: Graph = {
      nodes: [
        node("hangers", "Door hangers", "idea", { scheduledFor: "2026-01-05", recurrence: "monthly" }),
        node("flyers", "Flyers", "idea", { scheduledFor: "2026-04-01" }),
        node("printer", "Colour printer", "equipment"),
      ],
      edges: [edge("e1", "hangers", "printer"), edge("e2", "flyers", "printer")],
    };
    const leverage = leverageInWindow(recurring, today, 30);
    expect(leverage).toHaveLength(1);
    expect(leverage[0].uses.map((u) => u.due)).toEqual(["2026-04-01", "2026-04-05"]);
  });

  it("does not treat one scheduled idea leading to another as a shared resource", () => {
    const sequence: Graph = {
      nodes: [
        node("a", "Door hangers", "idea", { scheduledFor: "2026-03-26" }),
        node("b", "Follow-up calls", "idea", { scheduledFor: "2026-03-30" }),
        node("c", "Postcards", "idea", { scheduledFor: "2026-03-31" }),
      ],
      edges: [edge("e1", "a", "b"), edge("e2", "c", "b")],
    };
    expect(leverageInWindow(sequence, today, 30)).toHaveLength(0);
  });
});

describe("wording", () => {
  it("says it plainly", () => {
    expect(describeRecurrence("none")).toBe("One-off");
    expect(describeRecurrence("weekly")).toBe("Weekly");
    expect(describeRecurrence("weekly", 3)).toBe("Every 3 weeks");
    expect(describeRecurrence("monthly", 2)).toBe("Every 2 months");
  });

  it("describes when something is due in words near the day", () => {
    expect(describeDue("2026-03-25", "2026-03-25")).toBe("Today");
    expect(describeDue("2026-03-26", "2026-03-25")).toBe("Tomorrow");
    expect(describeDue("2026-03-24", "2026-03-25")).toBe("Yesterday");
    expect(describeDue("2026-03-18", "2026-03-25")).toBe("7 days ago");
    expect(describeDue("2026-03-30", "2026-03-25")).toBe("In 5 days");
    // Far enough out that the date itself is more use than the gap.
    expect(describeDue("2026-06-30", "2026-03-25")).toBe("2026-06-30");
  });
});

describe("leverage quantities", () => {
  it("adds up what one order would have to cover", () => {
    // Two print runs off the same cardstock, a fortnight apart. The number
    // worth knowing is 2,500 sheets, not "they both need paper".
    const graph: Graph = {
      nodes: [
        node("a", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
        node("b", "Flyers", "idea", { scheduledFor: "2026-04-05" }),
        { ...node("card", "Cardstock", "material"), estimatedCost: 0.1, unit: "sheet" },
      ],
      edges: [edge("e1", "a", "card", 2000), edge("e2", "b", "card", 500)],
    };

    const [leverage] = leverageInWindow(graph, "2026-03-25", 30);
    expect(leverage.totalQuantity).toBe(2500);
    expect(leverage.totalAmount).toBeCloseTo(250, 5);
  });

  it("says nothing rather than guessing when no quantities are filled in", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
        node("b", "Flyers", "idea", { scheduledFor: "2026-04-05" }),
        { ...node("printer", "Colour printer", "equipment"), estimatedCost: 400 },
      ],
      edges: [edge("e1", "a", "printer"), edge("e2", "b", "printer")],
    };

    const [leverage] = leverageInWindow(graph, "2026-03-25", 30);
    expect(leverage.totalQuantity).toBeNull();
    expect(leverage.totalAmount).toBeNull();
  });

  it("counts only the ideas inside the window", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
        node("b", "Flyers", "idea", { scheduledFor: "2026-04-05" }),
        node("c", "Autumn postcards", "idea", { scheduledFor: "2026-10-01" }),
        { ...node("card", "Cardstock", "material"), estimatedCost: 0.1, unit: "sheet" },
      ],
      edges: [
        edge("e1", "a", "card", 1000),
        edge("e2", "b", "card", 1000),
        edge("e3", "c", "card", 9000),
      ],
    };

    const [leverage] = leverageInWindow(graph, "2026-03-25", 30);
    expect(leverage.totalQuantity).toBe(2000);
  });
});

describe("leverage and kit", () => {
  it("never counts a shared printer as a quantity", () => {
    // Door hangers need two print runs; each run uses the printer. That is
    // two runs, not two printers, and a row about sharing one piece of kit
    // must not say "3".
    const graph: Graph = {
      nodes: [
        node("hangers", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
        node("flyers", "Flyers", "idea", { scheduledFor: "2026-04-02" }),
        node("run", "Print run", "process"),
        { ...node("printer", "Colour printer", "equipment"), estimatedCost: 420 },
      ],
      edges: [
        edge("e1", "hangers", "run", 2),
        edge("e2", "run", "printer", 1),
        edge("e3", "flyers", "printer", 1),
      ],
    };

    const printer = leverageInWindow(graph, "2026-03-25", 30).find(
      (l) => l.resource.title === "Colour printer"
    )!;
    expect(printer.totalQuantity).toBeNull();
    expect(printer.uses).toHaveLength(2);
  });

  it("follows the chain to find what two scheduled ideas really share", () => {
    // Door hangers never mention cardstock. Their print run does.
    const graph: Graph = {
      nodes: [
        node("hangers", "Door hangers", "idea", { scheduledFor: "2026-03-28" }),
        node("flyers", "Flyers", "idea", { scheduledFor: "2026-04-02" }),
        node("run", "Print run", "process"),
        { ...node("card", "Cardstock", "material"), estimatedCost: 0.1, unit: "sheet" },
      ],
      edges: [
        edge("e1", "hangers", "run", 2),
        edge("e2", "run", "card", 1000),
        edge("e3", "flyers", "card", 1500),
      ],
    };

    const card = leverageInWindow(graph, "2026-03-25", 30).find(
      (l) => l.resource.title === "Cardstock"
    )!;
    expect(card.totalQuantity).toBe(3500);
    expect(card.totalAmount).toBeCloseTo(350, 5);
  });
});
