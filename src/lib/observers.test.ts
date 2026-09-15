import { describe, expect, it } from "vitest";

import {
  OBSERVER_STEPS,
  headline,
  observerStage,
  relationshipLabel,
  stageProgress,
  type ObserverProject,
} from "@/lib/observers";
import type { StageInput } from "@/lib/job-stage";

function stageInput(o: Partial<StageInput> = {}): StageInput {
  return {
    status: "estimating",
    evaluationStatus: "scheduled",
    evaluationDate: null,
    proposalStatus: null,
    sessions: [],
    ...o,
  };
}

function project(o: Partial<ObserverProject> = {}): Pick<ObserverProject, "stage" | "visits" | "evaluationDate"> {
  return { stage: "evaluation", visits: [], evaluationDate: null, ...o };
}

describe("relationshipLabel", () => {
  it("uses the words somebody would say out loud", () => {
    expect(relationshipLabel("property_manager")).toBe("Property manager");
    expect(relationshipLabel("management_company")).toBe("Management company");
  });

  it("falls back rather than printing a raw value", () => {
    expect(relationshipLabel("something_new")).toBe("Other");
  });
});

describe("observerStage", () => {
  it("reads the same stage every other screen reads", () => {
    // A watcher must never be told something the job page disagrees with.
    expect(observerStage(stageInput({ status: "completed" }))).toBe("done");
    expect(observerStage(stageInput({ evaluationStatus: "completed" }))).toBe("pricing");
    expect(observerStage(stageInput({ status: "cancelled" }))).toBe("cancelled");
  });
});

describe("stageProgress", () => {
  it("runs from the first step to the last", () => {
    expect(stageProgress("evaluation")).toBeCloseTo(1 / 5);
    expect(stageProgress("done")).toBe(1);
  });

  it("has no position for a cancelled project", () => {
    // Cancelled is an absence of progress, not a point in it.
    expect(stageProgress("cancelled")).toBeNull();
  });

  it("covers every step it claims to", () => {
    for (const step of OBSERVER_STEPS) {
      expect(stageProgress(step)).not.toBeNull();
    }
  });
});

describe("headline", () => {
  it("gives the day when there is one, rather than a vague stage", () => {
    // "Booked in" with no day is the answer that makes somebody ring to ask
    // the actual question.
    const text = headline(
      project({
        stage: "scheduled",
        visits: [{ startsOn: "2026-08-24", endsOn: "2026-08-25", status: "scheduled", purpose: null }],
      })
    );
    expect(text).toContain("Booked in for");
    expect(text).toContain("August");
  });

  it("names the evaluation day while it is still coming", () => {
    const text = headline(project({ stage: "evaluation", evaluationDate: "2026-08-20T13:00:00Z" }));
    expect(text).toContain("coming out on");
  });

  it("says a paused job is paused rather than claiming the crew are on it", () => {
    const text = headline(
      project({
        stage: "working",
        visits: [{ startsOn: "2026-08-19", endsOn: "2026-08-19", status: "paused", purpose: null }],
      })
    );
    expect(text).toContain("paused");
  });

  it("says the crew are on it when nothing is paused", () => {
    const text = headline(
      project({
        stage: "working",
        visits: [{ startsOn: "2026-08-19", endsOn: "2026-08-19", status: "in_progress", purpose: null }],
      })
    );
    expect(text).toBe("The crew are on it.");
  });

  it("says a cancelled project is cancelled and nothing else", () => {
    expect(headline(project({ stage: "cancelled" }))).toContain("called off");
  });

  it("falls back to the stage blurb with no dates to offer", () => {
    expect(headline(project({ stage: "pricing" }))).toContain("proposal");
  });
});

describe("the shape carries no money", () => {
  it("has nowhere to put a price", () => {
    // The same guarantee the crew sheet makes: absent from the shape rather
    // than hidden by the component, so no future change can leak one.
    const shape: ObserverProject = {
      address: "12 Elm St",
      customerName: "Pat Rivera",
      organizationName: "JS Landscaping",
      stage: "working",
      contact: { name: "Mike", phone: "555" },
      zones: [{ name: "Front bed", service: "Mulch", location: "Front", notes: "", photos: [] }],
      visits: [],
      evaluationDate: null,
      completedAt: null,
      watcherName: "Dana",
      relationship: "property_manager",
    };
    const serialised = JSON.stringify(shape);
    expect(serialised).not.toContain("price");
    expect(serialised).not.toContain("cost");
    expect(serialised).not.toContain("total");
  });
});
