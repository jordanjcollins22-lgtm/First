import { describe, expect, it } from "vitest";

import { indeedAd, needsPay, PAY_MISSING, publicPayLine } from "@/lib/hiring/indeed-ad";
import { POSITIONS, positionFor, type Position } from "@/lib/hiring/positions";
import { cleanAnswers, cleanContact, missing, nextStages, screen } from "@/lib/hiring/screening";

const tech = positionFor("project-technician") as Position;
const lead = positionFor("project-lead") as Position;
const affiliate = positionFor("affiliate") as Position;

/** Everything answered with a passing answer, or the first option. */
function goodAnswers(position: Position): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of position.questions) {
    out[q.key] = q.passes ? q.passes[0] : q.kind === "yesno" ? "yes" : q.kind === "choice" ? q.options![0] : "Because I like the work.";
  }
  return out;
}

const CONTACT = { name: "Sample Applicant", email: "sample@example.com", phone: "(410) 555-0100", zip: "21050" };

describe("positions", () => {
  it("has the five roles we hire for", () => {
    expect(POSITIONS.map((p) => p.key).sort()).toEqual(["account-manager", "affiliate", "evaluator", "project-lead", "project-technician"]);
  });

  it("gives every role at least one knockout and a video prompt", () => {
    for (const p of POSITIONS) {
      expect(p.questions.some((q) => q.passes)).toBe(true);
      expect(p.videoPrompt.length).toBeGreaterThan(20);
    }
  });

  it("never repeats a question within a role", () => {
    for (const p of POSITIONS) {
      const keys = p.questions.map((q) => q.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("asks driving roles for a license and not the desk and online roles", () => {
    expect(tech.questions.some((q) => q.key === "license")).toBe(true);
    expect(lead.questions.some((q) => q.key === "license")).toBe(true);
    expect(positionFor("evaluator")!.questions.some((q) => q.key === "license")).toBe(true);
    expect(affiliate.questions.some((q) => q.key === "license")).toBe(false);
    expect(positionFor("account-manager")!.questions.some((q) => q.key === "license")).toBe(false);
  });
});

describe("screening", () => {
  it("passes an applicant who answers every knockout right", () => {
    for (const p of POSITIONS) expect(screen(p, goodAnswers(p))).toEqual({ passed: true, reasons: [] });
  });

  it("screens out on a knockout and says which, in our words", () => {
    const answers = { ...goodAnswers(tech), lift50: "no" };
    expect(screen(tech, answers)).toEqual({ passed: false, reasons: ["Can't lift 50 lb"] });
  });

  it("needs two years for a lead", () => {
    expect(screen(lead, { ...goodAnswers(lead), years: "1 to 2" }).passed).toBe(false);
    expect(screen(lead, { ...goodAnswers(lead), years: "More than 5" }).passed).toBe(true);
  });

  it("does not knock anyone out on an experience question that is only for reading", () => {
    expect(screen(tech, { ...goodAnswers(tech), experience: "None, I'm ready to learn" }).passed).toBe(true);
  });

  it("treats an unanswered knockout as not passed", () => {
    const answers = goodAnswers(affiliate);
    delete answers.commission_only;
    expect(screen(affiliate, answers).passed).toBe(false);
  });
});

describe("cleaning what was sent", () => {
  it("keeps only this role's questions and known answers", () => {
    const cleaned = cleanAnswers(tech, { lift50: "yes", early: "maybe", made_up: "yes", start: "Right away", experience: "Wizard" });
    expect(cleaned).toEqual({ lift50: "yes", start: "Right away" });
  });

  it("trims and caps free text", () => {
    const cleaned = cleanAnswers(tech, { why: `  ${"a".repeat(3000)}  ` });
    expect(cleaned.why.length).toBe(1500);
  });

  it("lists what is missing before it can be sent", () => {
    const answers = goodAnswers(tech);
    expect(missing(tech, CONTACT, answers)).toEqual([]);
    expect(missing(tech, { ...CONTACT, email: "nope", zip: "2105" }, answers)).toEqual([
      "An email address we can reach you at",
      "Your 5-digit ZIP code",
    ]);
    delete answers.why;
    expect(missing(tech, CONTACT, answers)).toContain("Why do you want this job? A couple of sentences is plenty.");
  });

  it("lowercases the email and trims the contact", () => {
    expect(cleanContact({ name: "  Sam  ", email: " Sam@Example.COM ", phone: " 410 ", zip: "21050 " })).toEqual({
      name: "Sam",
      email: "sam@example.com",
      phone: "410",
      zip: "21050",
    });
  });
});

describe("stages", () => {
  it("only lets a person, not the form, decide an interview or a hire", () => {
    expect(nextStages("video_requested")).not.toContain("interview");
    expect(nextStages("video_submitted")).toEqual(["interview", "not_a_fit"]);
    expect(nextStages("interview")).toEqual(["hired", "not_a_fit"]);
    expect(nextStages("hired")).toEqual([]);
  });

  it("lets a wrongly screened-out applicant be asked for a video after all", () => {
    expect(nextStages("screened_out")).toEqual(["video_requested"]);
  });
});

describe("the Indeed ad", () => {
  const input = { business: "Sample Landscaping", area: "Harford County, MD", applyUrl: "https://example.com/careers/project-lead" };

  it("says loudly when the pay is missing, so it isn't posted without", () => {
    const ad = indeedAd(lead, input);
    expect(needsPay(lead)).toBe(true);
    expect(ad.body).toContain(PAY_MISSING);
  });

  it("never shows applicants the placeholder on our own page", () => {
    expect(publicPayLine(affiliate)).toBe("4% commission on every job that books through your link");
    expect(publicPayLine(lead)).toBeNull();
    for (const p of POSITIONS) expect(publicPayLine(p) ?? "").not.toContain(PAY_MISSING);
  });

  it("carries the apply link and the video step", () => {
    const ad = indeedAd(lead, input);
    expect(ad.title).toBe(lead.title);
    expect(ad.body).toContain(input.applyUrl);
    expect(ad.body.toLowerCase()).toContain("video");
  });

  it("states commission where the role has it", () => {
    expect(indeedAd(affiliate, input).body).toContain("4% commission");
    expect(indeedAd(positionFor("account-manager")!, input).body).toContain("7% commission");
  });
});
