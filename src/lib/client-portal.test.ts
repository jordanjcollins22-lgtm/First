import { describe, expect, it } from "vitest";

import {
  cleanCode,
  codeLooksComplete,
  looksLikeEmail,
  nextStepFor,
  orderProjects,
  sentMessage,
  stageLabel,
  type ClientProject,
  type ProjectStage,
} from "@/lib/client-portal";

function project(over: Partial<ClientProject> = {}): ClientProject {
  return {
    jobId: "j1",
    address: "3100 Trellis Lane",
    stage: "quoted",
    evaluationAt: null,
    digital: false,
    proposalToken: "tok",
    proposalStatus: "sent",
    totalCost: 350,
    outstandingCents: 0,
    progressToken: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const ALL: ProjectStage[] = [
  "evaluation_booked",
  "quoted",
  "accepted",
  "scheduled",
  "in_progress",
  "finished",
  "cancelled",
];

describe("what the client is told a project is doing", () => {
  it("has words for every stage", () => {
    for (const stage of ALL) {
      expect(stageLabel(stage).length, stage).toBeGreaterThan(0);
    }
  });

  it("uses the client's words, not ours", () => {
    // "Quoted" is our word for it. "Quote ready" is what it means to them.
    expect(stageLabel("quoted")).toBe("Quote ready");
    expect(stageLabel("accepted")).toBe("Booked in");
  });
});

describe("the one thing worth doing next", () => {
  it("points at the quote when there is one to read", () => {
    expect(nextStepFor(project({ stage: "quoted" }))).toMatch(/quote/i);
  });

  it("says nothing about a quote there is no link to", () => {
    expect(nextStepFor(project({ stage: "quoted", proposalToken: null }))).toBeNull();
  });

  it("mentions a balance once there is one", () => {
    expect(nextStepFor(project({ stage: "accepted", outstandingCents: 31_500 }))).toMatch(/balance/i);
  });

  it("does not chase money before there is a quote to owe against", () => {
    const early = project({ stage: "evaluation_booked", outstandingCents: 31_500 });
    expect(nextStepFor(early)).not.toMatch(/balance/i);
  });

  it("says which kind of evaluation is coming", () => {
    expect(nextStepFor(project({ stage: "evaluation_booked", digital: false }))).toMatch(/come out/i);
    expect(nextStepFor(project({ stage: "evaluation_booked", digital: true }))).toMatch(/call/i);
  });

  it("has nothing to ask of a finished or cancelled job", () => {
    expect(nextStepFor(project({ stage: "finished" }))).toBeNull();
    expect(nextStepFor(project({ stage: "cancelled", outstandingCents: 100 }))).toBeNull();
  });
});

describe("the order projects are shown in", () => {
  it("puts the live one at the top", () => {
    const ordered = orderProjects([
      project({ jobId: "old", stage: "finished" }),
      project({ jobId: "live", stage: "in_progress" }),
      project({ jobId: "quote", stage: "quoted" }),
    ]);
    expect(ordered[0].jobId).toBe("live");
  });

  it("puts a cancelled one last", () => {
    const ordered = orderProjects([
      project({ jobId: "dead", stage: "cancelled" }),
      project({ jobId: "done", stage: "finished" }),
    ]);
    expect(ordered[ordered.length - 1].jobId).toBe("dead");
  });

  it("breaks a tie on what changed most recently", () => {
    const ordered = orderProjects([
      project({ jobId: "stale", stage: "quoted", updatedAt: "2026-01-01T00:00:00Z" }),
      project({ jobId: "fresh", stage: "quoted", updatedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(ordered[0].jobId).toBe("fresh");
  });

  it("keeps every project", () => {
    const many = ALL.map((stage) => project({ jobId: stage, stage }));
    expect(orderProjects(many)).toHaveLength(ALL.length);
  });

  it("does not change the list it was handed", () => {
    const input = [project({ jobId: "a", stage: "finished" }), project({ jobId: "b", stage: "in_progress" })];
    orderProjects(input);
    expect(input[0].jobId).toBe("a");
  });
});

describe("the email box", () => {
  it("takes an ordinary address", () => {
    expect(looksLikeEmail("jordan@example.com")).toBe(true);
    expect(looksLikeEmail("  jordan+lawn@example.co.uk ")).toBe(true);
  });

  it("turns away something that is plainly not one", () => {
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("jordan")).toBe(false);
    expect(looksLikeEmail("jordan@example")).toBe(false);
    expect(looksLikeEmail("a b@example.com")).toBe(false);
  });

  it("never says whether the address is one of ours", () => {
    // Somebody typing addresses in to find out who our clients are should
    // learn nothing at all.
    const message = sentMessage("stranger@example.com");
    expect(message).toMatch(/if .* is on one of our jobs/i);
    expect(message).not.toMatch(/\bnot found|no account|unknown\b/i);
  });
});

describe("the code box", () => {
  it("keeps the digits and drops everything else", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56")).toBe("123456");
  });

  it("does not run past six", () => {
    expect(cleanCode("1234567890")).toBe("123456");
  });

  it("knows when it is finished", () => {
    expect(codeLooksComplete("12345")).toBe(false);
    expect(codeLooksComplete("123456")).toBe(true);
    expect(codeLooksComplete("12 34 56")).toBe(true);
    expect(codeLooksComplete("abcdef")).toBe(false);
  });
});
