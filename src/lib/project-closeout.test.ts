import { describe, expect, it } from "vitest";

import {
  aftersMissing,
  beforeAfterEmail,
  beforeAfterPairs,
  canSendForApproval,
  canSignOffProject,
  clientApprovalGate,
  closeoutSteps,
  projectTimeline,
  type CloseoutInput,
  type TimelineInput,
} from "./project-closeout";

const base: TimelineInput = {
  evaluationDate: null,
  evaluationStatus: "scheduled",
  evaluationSubmittedAt: null,
  proposal: null,
  jobStatus: "estimating",
  projectStartDate: null,
  firstVisitOn: null,
  crewArrivedAt: null,
  review: null,
  photosApprovedAt: null,
  completedAt: null,
  now: new Date("2026-09-27T12:00:00Z"),
};

const done = (input: TimelineInput) => Object.fromEntries(projectTimeline(input).map((m) => [m.key, m.done]));

describe("projectTimeline", () => {
  it("is all not-yet on a new job", () => {
    expect(Object.values(done(base)).every((d) => !d)).toBe(true);
  });

  it("shows a booked evaluation in the future as upcoming, not done", () => {
    const booked = projectTimeline({ ...base, evaluationDate: "2026-09-30T17:00:00Z" }).find((m) => m.key === "booked")!;
    expect(booked.done).toBe(true);
    expect(booked.upcoming).toBe(true);
  });

  it("counts a proposal as sent only once it reached them", () => {
    const approvedNotSent = { ...base, evaluationStatus: "completed", proposal: { status: "sent", sentAt: null, respondedAt: null } };
    expect(done(approvedNotSent)["proposal-sent"]).toBe(false);
    expect(done({ ...approvedNotSent, proposal: { status: "sent", sentAt: "2026-09-20T10:00:00Z", respondedAt: null } })["proposal-sent"]).toBe(true);
  });

  it("walks a finished job all the way to signed off", () => {
    const finished = done({
      ...base,
      evaluationDate: "2026-09-01T14:00:00Z",
      evaluationStatus: "completed",
      evaluationSubmittedAt: "2026-09-01T15:00:00Z",
      proposal: { status: "accepted", sentAt: "2026-09-02T10:00:00Z", respondedAt: "2026-09-03T10:00:00Z" },
      jobStatus: "completed",
      projectStartDate: "2026-09-10",
      crewArrivedAt: "2026-09-10T12:00:00Z",
      review: { status: "approved", sentAt: "2026-09-11T10:00:00Z", respondedAt: "2026-09-11T12:00:00Z", clientNote: null, inPerson: false },
      photosApprovedAt: "2026-09-11T13:00:00Z",
      completedAt: "2026-09-11T13:00:00Z",
    });
    expect(Object.values(finished).every(Boolean)).toBe(true);
  });

  it("does not call a crew-completed job signed off until the photos are approved", () => {
    expect(done({ ...base, jobStatus: "completed", completedAt: "2026-09-11T13:00:00Z" })["signed-off"]).toBe(false);
  });
});

const ready: CloseoutInput = {
  started: true,
  walkthrough: { ok: true },
  aftersComplete: true,
  aftersMissing: [],
  review: null,
  openMarks: 0,
  photosApprovedAt: null,
  jobStatus: "in_progress",
};

describe("closing a job", () => {
  it("will not send the before and afters before the walk", () => {
    const verdict = canSendForApproval({ ...ready, walkthrough: { ok: false, reason: "Waiting on the account manager to walk the job." } });
    expect(verdict).toEqual({ ok: false, reason: "Waiting on the account manager to walk the job." });
  });

  it("will not send them with afters missing, and names the areas", () => {
    const verdict = canSendForApproval({ ...ready, aftersComplete: false, aftersMissing: ["Front bed"] });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain("Front bed");
  });

  it("will not sign off until the client has approved", () => {
    expect(canSignOffProject(ready).ok).toBe(false);
    const sent = { ...ready, review: { status: "sent" as const, sentAt: "x", respondedAt: null, clientNote: null, inPerson: false } };
    expect(canSignOffProject(sent)).toEqual({ ok: false, reason: "Waiting on the client to approve the before & afters." });
    const changes = { ...ready, review: { status: "changes" as const, sentAt: "x", respondedAt: "y", clientNote: "Edging", inPerson: false } };
    expect(canSignOffProject(changes).ok).toBe(false);
    const approved = { ...ready, review: { status: "approved" as const, sentAt: "x", respondedAt: "y", clientNote: null, inPerson: false } };
    expect(canSignOffProject(approved)).toEqual({ ok: true });
    expect(canSignOffProject({ ...approved, openMarks: 2 }).ok).toBe(false);
  });

  it("lets the job be re-sent after the client asked for changes", () => {
    const changes = { ...ready, review: { status: "changes" as const, sentAt: "x", respondedAt: "y", clientNote: "Edging", inPerson: false } };
    expect(canSendForApproval(changes).ok).toBe(true);
  });

  it("gates the crew's own sign-off on the client's approval", () => {
    expect(clientApprovalGate(null).ok).toBe(false);
    expect(clientApprovalGate({ status: "approved", sentAt: "x", respondedAt: "y", clientNote: null, inPerson: true }).ok).toBe(true);
  });

  it("lists the steps in the order they happen", () => {
    expect(closeoutSteps(ready).map((s) => s.key)).toEqual(["walk", "afters", "send", "client", "approve"]);
    const steps = closeoutSteps({ ...ready, review: { status: "changes", sentAt: "x", respondedAt: "y", clientNote: "The edging", inPerson: false } });
    expect(steps.find((s) => s.key === "client")!.note).toContain("The edging");
  });
});

describe("before and after pairs", () => {
  const zones = [
    { id: "a", name: "Front bed" },
    { id: "b", name: "Back lawn" },
  ];

  it("pairs the first before with the last after, per area", () => {
    const pairs = beforeAfterPairs(
      [
        { kind: "before", zoneId: "a", zoneName: "Front bed", url: "b1", createdAt: "2026-09-01" },
        { kind: "before", zoneId: "a", zoneName: "Front bed", url: "b2", createdAt: "2026-09-02" },
        { kind: "after", zoneId: "a", zoneName: "Front bed", url: "a1", createdAt: "2026-09-10" },
        { kind: "after", zoneId: "a", zoneName: "Front bed", url: "a2", createdAt: "2026-09-11" },
      ],
      zones
    );
    expect(pairs).toEqual([{ zoneId: "a", zoneName: "Front bed", before: "b1", after: "a2" }]);
  });

  it("names the areas still missing an after, leaving out waived ones", () => {
    expect(aftersMissing([{ kind: "after", zoneId: "a" }], zones, new Set())).toEqual(["Back lawn"]);
    expect(aftersMissing([{ kind: "after", zoneId: "a" }], zones, new Set(["b"]))).toEqual([]);
  });
});

describe("beforeAfterEmail", () => {
  it("carries the link and makes no promises beyond fixing it", () => {
    const email = beforeAfterEmail({ clientName: "Linda Holden", businessName: "JS Landscaping MD", link: "https://x/done/abc", signedBy: "Jordan" });
    expect(email.text).toContain("Hi Linda,");
    expect(email.text).toContain("https://x/done/abc");
    expect(email.text).not.toMatch(/[—–]/);
  });
});
