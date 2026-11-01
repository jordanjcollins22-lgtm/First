import { describe, expect, it } from "vitest";

import { applicantChecks, cardForApplicant, planApplicantSync, type Applicant } from "./applicant-sync";

const applicant = (over: Partial<Applicant> = {}): Applicant => ({
  id: "a1",
  name: "Mike Diaz",
  phone: "410-555-0100",
  email: "mike@example.com",
  zip: "21401",
  position: "project-technician",
  source: "indeed",
  stage: "video_requested",
  video_submitted_at: null,
  interview_at: null,
  created_at: "2026-10-20T00:00:00Z",
  ...over,
});

describe("cardForApplicant", () => {
  it("makes a Team card with their details under External", () => {
    const card = cardForApplicant(applicant());
    expect(card.pipeline).toBe("team");
    expect(card.title).toBe("Mike Diaz");
    expect(card.backlog_group).toBe("External");
    expect(card.details).toBe(
      "Position: Project technician\nPhone: 410-555-0100\nEmail: mike@example.com\nZip: 21401\nSource: indeed"
    );
  });
});

describe("planApplicantSync", () => {
  it("adds applicants still in the running, oldest first, once", () => {
    const { toAdd } = planApplicantSync(
      [
        applicant({ id: "new", created_at: "2026-10-25T00:00:00Z" }),
        applicant({ id: "old", created_at: "2026-10-10T00:00:00Z" }),
        applicant({ id: "out", stage: "screened_out" }),
        applicant({ id: "carded" }),
      ],
      [{ id: "c1", applicant_id: "carded", stage: "backlog" }]
    );
    expect(toAdd.map((c) => c.applicant_id)).toEqual(["old", "new"]);
  });

  it("takes Backlog cards off for applicants who are out, and leaves the rest", () => {
    const { toRemove } = planApplicantSync(
      [applicant({ id: "w", stage: "withdrawn" }), applicant({ id: "n", stage: "not_a_fit" })],
      [
        { id: "c1", applicant_id: "w", stage: "backlog" },
        { id: "c2", applicant_id: "n", stage: "answer" },
      ]
    );
    expect(toRemove).toEqual(["c1"]);
  });
});

describe("applicantChecks", () => {
  const yes = (a: Partial<Applicant>) => applicantChecks(applicant(a)).map((c) => c.yes);
  it("reads the hiring stage", () => {
    expect(yes({})).toEqual([false, false, false]);
    expect(yes({ stage: "video_submitted" })).toEqual([true, false, false]);
    expect(yes({ stage: "interview" })).toEqual([true, true, false]);
    expect(yes({ stage: "hired" })).toEqual([true, true, true]);
  });
});
