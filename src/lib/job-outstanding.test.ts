import { describe, expect, it } from "vitest";

import {
  dueNext,
  sectionForItem,
  sectionToOpen,
  dueNextLabel,
  outstandingFor,
  progress,
  waitingOn,
  zonesMissing,
  type JobFacts,
} from "./job-outstanding";

const BASE: JobFacts = {
  stage: "evaluation",
  evaluationBooked: false,
  evaluationDone: false,
  zonesMeasured: 0,
  proposalStatus: null,
  scheduled: false,
  visitsBooked: 0,
  zoneNames: [],
  photosByZone: {},
  walkthroughRequested: false,
  walkthroughApproved: false,
  signedOff: false,
  invoiced: false,
};

/** A job that has been sold, with two zones to photograph. */
const SOLD: JobFacts = {
  ...BASE,
  stage: "working",
  evaluationBooked: true,
  evaluationDone: true,
  zonesMeasured: 2,
  proposalStatus: "accepted",
  scheduled: true,
  visitsBooked: 1,
  zoneNames: ["Front bed", "Side path"],
  photosByZone: {
    "Front bed": ["before", "during", "after"],
    "Side path": ["before", "during", "after"],
  },
};

function ids(facts: JobFacts): string[] {
  return outstandingFor(facts).map((i) => i.id);
}

describe("outstandingFor", () => {
  it("owes nothing on a cancelled job", () => {
    expect(outstandingFor({ ...SOLD, stage: "cancelled" })).toEqual([]);
  });

  it("does not list the work before the job is sold", () => {
    // A job still being priced is not missing its after photos. Listing them
    // turns the list into noise nobody reads.
    expect(ids(BASE)).not.toContain("photos_after");
    expect(ids(BASE)).not.toContain("signed_off");
  });

  it("lists the work once it is sold", () => {
    const list = ids(SOLD);
    for (const id of ["booked", "visits", "photos_before", "photos_after", "signed_off", "invoiced"]) {
      expect(list).toContain(id);
    }
  });

  it("ticks what has actually happened", () => {
    const done = outstandingFor(SOLD).filter((i) => i.done).map((i) => i.id);
    expect(done).toContain("evaluation_done");
    expect(done).toContain("proposal_signed");
    expect(done).toContain("photos_after");
  });
});

describe("photos", () => {
  it("knows which zones are still missing a stage", () => {
    const facts = {
      ...SOLD,
      photosByZone: { "Front bed": ["before", "during", "after"], "Side path": ["before"] },
    };
    expect(zonesMissing(facts, "after")).toEqual(["Side path"]);
    expect(zonesMissing(facts, "before")).toEqual([]);
  });

  it("names the zones rather than counting them", () => {
    // "2 zones missing after photos" sends somebody hunting; the names send
    // them to the right part of the property.
    const facts = {
      ...SOLD,
      photosByZone: { "Front bed": ["before", "during", "after"], "Side path": ["before"] },
    };
    const after = outstandingFor(facts).find((i) => i.id === "photos_after")!;
    expect(after.done).toBe(false);
    expect(after.label).toBe("After photos: Side path");
  });

  it("says every zone rather than listing all of them", () => {
    const facts = { ...SOLD, photosByZone: {} };
    const after = outstandingFor(facts).find((i) => i.id === "photos_after")!;
    expect(after.label).toBe("After photos for every zone");
  });

  it("is not satisfied by a job with no zones at all", () => {
    // Nothing photographed and nothing to photograph is not "done", it is a
    // site map nobody has drawn.
    const facts = { ...SOLD, zoneNames: [], photosByZone: {} };
    expect(outstandingFor(facts).find((i) => i.id === "photos_before")!.done).toBe(false);
  });
});

describe("dueNext", () => {
  it("is the first thing nobody here has done", () => {
    expect(dueNext(outstandingFor(BASE))!.id).toBe("evaluation_booked");
  });

  it("moves on as things get done", () => {
    const booked = { ...BASE, evaluationBooked: true };
    expect(dueNext(outstandingFor(booked))!.id).toBe("evaluation_done");
  });

  it("skips what we cannot do anything about", () => {
    // Telling somebody to sign a proposal on the client's behalf is a page
    // they stop reading.
    const sent = { ...BASE, evaluationBooked: true, evaluationDone: true, zonesMeasured: 1, proposalStatus: "sent" };
    expect(dueNext(outstandingFor(sent))).toBeNull();
    expect(waitingOn(outstandingFor(sent))!.id).toBe("proposal_signed");
  });

  it("is the missing photos once the crew is on site", () => {
    const facts = { ...SOLD, photosByZone: { "Front bed": ["before"], "Side path": ["before"] } };
    expect(dueNext(outstandingFor(facts))!.id).toBe("photos_during");
  });

  it("is null when everything is done", () => {
    const finished = { ...SOLD, walkthroughApproved: true, signedOff: true, invoiced: true };
    expect(dueNext(outstandingFor(finished))).toBeNull();
  });
});

describe("dueNextLabel", () => {
  it("is one sentence, always", () => {
    expect(dueNextLabel(outstandingFor(BASE))).toBe("Evaluation booked");
  });

  it("says what is being waited on when there is nothing to do", () => {
    const sent = { ...BASE, evaluationBooked: true, evaluationDone: true, zonesMeasured: 1, proposalStatus: "sent" };
    expect(dueNextLabel(outstandingFor(sent))).toBe("Waiting: proposal signed");
  });

  it("says so when the job is finished", () => {
    const finished = { ...SOLD, walkthroughApproved: true, signedOff: true, invoiced: true };
    expect(dueNextLabel(outstandingFor(finished))).toBe("All done");
  });

  it("says nothing is outstanding on a cancelled job", () => {
    expect(dueNextLabel(outstandingFor({ ...SOLD, stage: "cancelled" }))).toBe("Nothing outstanding");
  });

  it("uses no dashes", () => {
    expect(dueNextLabel(outstandingFor(SOLD))).not.toMatch(/[—–]/);
  });
});

describe("progress", () => {
  it("counts what is submitted against what is owed", () => {
    const p = progress(outstandingFor(SOLD));
    expect(p.total).toBeGreaterThan(p.done);
    expect(p.done).toBeGreaterThan(0);
  });

  it("is everything on a finished job", () => {
    const finished = { ...SOLD, walkthroughApproved: true, signedOff: true, invoiced: true };
    const p = progress(outstandingFor(finished));
    expect(p.done).toBe(p.total);
  });
});

describe("sectionToOpen", () => {
  it("opens the section that answers what is due", () => {
    // Tapping through three collapsed sections to reach the thing the page
    // just said was due is how people stop trusting a summary.
    expect(sectionToOpen(outstandingFor(BASE))).toBe("schedule");
    const facts = { ...SOLD, photosByZone: { "Front bed": ["before"], "Side path": ["before"] } };
    expect(sectionToOpen(outstandingFor(facts))).toBe("photos");
  });

  it("opens nothing when there is nothing to do", () => {
    const sent = { ...BASE, evaluationBooked: true, evaluationDone: true, zonesMeasured: 1, proposalStatus: "sent" };
    expect(sectionToOpen(outstandingFor(sent))).toBeNull();
  });

  it("has a section for every item it can produce", () => {
    // A due item with nowhere to send somebody is a dead end.
    const everyItem = [...outstandingFor(BASE), ...outstandingFor(SOLD)];
    for (const item of everyItem) {
      expect(sectionForItem(item.id), item.id).not.toBeNull();
    }
  });

  it("returns nothing for an id it does not know", () => {
    expect(sectionForItem("nonsense")).toBeNull();
    expect(sectionForItem(null)).toBeNull();
  });
});
