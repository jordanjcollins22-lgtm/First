import { describe, expect, it } from "vitest";

import {
  linkLabel,
  linkToJob,
  mayMarkPaid,
  tallyLine,
  type ImportTally,
  type JobCandidate,
} from "./payment-linking";

function job(over: Partial<JobCandidate> = {}): JobCandidate {
  return { jobId: "j1", totalCents: 420000, paid: false, createdAt: "2026-01-01", ...over };
}

describe("linkToJob", () => {
  it("takes the only job there is", () => {
    const link = linkToJob(420000, [job()]);
    expect(link).toEqual({ jobId: "j1", reason: "only_job" });
  });

  it("takes the only job even when the amount is a deposit", () => {
    // A part payment against the only job on file is still against that job.
    expect(linkToJob(50000, [job()]).jobId).toBe("j1");
  });

  it("picks the job whose quote it pays", () => {
    const link = linkToJob(420000, [job(), job({ jobId: "j2", totalCents: 90000 })]);
    expect(link).toEqual({ jobId: "j1", reason: "amount_matches" });
  });

  it("allows for a card fee or a discount agreed on the phone", () => {
    expect(linkToJob(410000, [job(), job({ jobId: "j2", totalCents: 90000 })]).jobId).toBe("j1");
  });

  it("refuses to guess between two jobs quoted the same", () => {
    // The case where a guess is wrong half the time.
    const link = linkToJob(420000, [job(), job({ jobId: "j2" })]);
    expect(link).toEqual({ jobId: null, reason: "ambiguous" });
  });

  it("refuses when several jobs have no price to compare", () => {
    const link = linkToJob(420000, [
      job({ totalCents: null }),
      job({ jobId: "j2", totalCents: null }),
    ]);
    expect(link.jobId).toBeNull();
  });

  it("looks past a job that is already paid", () => {
    const link = linkToJob(90000, [job({ paid: true }), job({ jobId: "j2", totalCents: 90000 })]);
    expect(link).toEqual({ jobId: "j2", reason: "only_job" });
  });

  it("still answers when every job is already paid", () => {
    expect(linkToJob(420000, [job({ paid: true })]).jobId).toBe("j1");
  });

  it("says so when the client has no jobs at all", () => {
    expect(linkToJob(420000, [])).toEqual({ jobId: null, reason: "no_jobs" });
  });
});

describe("mayMarkPaid", () => {
  it("only where a job was actually picked", () => {
    expect(mayMarkPaid({ jobId: "j1", reason: "only_job" })).toBe(true);
    expect(mayMarkPaid({ jobId: null, reason: "ambiguous" })).toBe(false);
  });
});

describe("linkLabel", () => {
  it("says what happened, and what is left to do", () => {
    expect(linkLabel({ jobId: null, reason: "ambiguous" })).toMatch(/somebody to assign/i);
    expect(linkLabel({ jobId: null, reason: "no_jobs" })).toMatch(/no job on this client/i);
    expect(linkLabel({ jobId: "j1", reason: "only_job" })).toMatch(/only job/i);
  });
});

function tally(over: Partial<ImportTally> = {}): ImportTally {
  return {
    recorded: 0,
    linked: 0,
    unlinked: 0,
    skipped: 0,
    refunded: 0,
    notSettled: 0,
    clientsCreated: 0,
    totalCents: 0,
    ...over,
  };
}

describe("tallyLine", () => {
  it("reads as a sentence at the end of an import", () => {
    expect(tallyLine(tally({ recorded: 12, linked: 9, unlinked: 3, skipped: 1, totalCents: 4_200_00 }))).toBe(
      "12 payments in, $4,200. 9 matched to a job. 3 waiting for somebody to say which job. 1 skipped."
    );
  });

  it("is singular when it is one", () => {
    expect(
      tallyLine(tally({ recorded: 1, linked: 1, totalCents: 100_00 }))
    ).toBe("1 payment in, $100. 1 matched to a job.");
  });

  it("says plainly when a re-run brought nothing new", () => {
    expect(tallyLine(tally({ skipped: 4 }))).toMatch(/already here/i);
  });
});

describe("the tally reconciles against the file", () => {
  it("says what was refunded and what failed, rather than leaving a gap", () => {
    // The complaint this exists for: a total on screen that is smaller than
    // the file, with nothing saying why.
    const line = tallyLine(
      tally({ recorded: 124, linked: 100, unlinked: 24, refunded: 6, notSettled: 10, totalCents: 24_154_211 })
    );
    expect(line).toContain("124 payments in, $241,542");
    expect(line).toContain("6 refunded, not counted as taken");
    expect(line).toContain("10 failed or pending, not counted");
  });

  it("says when it had to make contacts for payers nobody had", () => {
    const line = tallyLine(tally({ recorded: 12, clientsCreated: 3, totalCents: 100_00 }));
    expect(line).toContain("3 new contacts made for payers nobody had");
  });

  it("is singular for the one contact", () => {
    expect(tallyLine(tally({ recorded: 1, clientsCreated: 1, totalCents: 100_00 }))).toContain(
      "1 new contact made"
    );
  });
});
