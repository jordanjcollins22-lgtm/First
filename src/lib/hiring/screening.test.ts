import { describe, expect, it } from "vitest";

import { indeedAd, indeedPayFields, needsPay, PAY_MISSING, payLine, publicPayLine } from "@/lib/hiring/indeed-ad";
import { OPEN_POSITIONS, POSITIONS, openPositionFor, positionFor, type Position } from "@/lib/hiring/positions";
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

  it("asks driving roles for a license and not the online role", () => {
    expect(tech.questions.some((q) => q.key === "license")).toBe(true);
    expect(lead.questions.some((q) => q.key === "license")).toBe(true);
    expect(positionFor("evaluator")!.questions.some((q) => q.key === "license")).toBe(true);
    expect(affiliate.questions.some((q) => q.key === "license")).toBe(false);
    // Account managers drive to paid site visits now that evaluators are gone.
    expect(positionFor("account-manager")!.questions.some((q) => q.key === "license")).toBe(true);
  });

  it("takes applications only for the roles we still have", () => {
    expect(OPEN_POSITIONS.map((p) => p.key).sort()).toEqual(["account-manager", "affiliate", "project-technician"]);
    expect(openPositionFor("evaluator")).toBeNull();
    expect(openPositionFor("project-lead")).toBeNull();
    expect(openPositionFor("project-technician")?.key).toBe("project-technician");
    // Closed, not deleted: past applicants still have their job.
    expect(positionFor("project-lead")?.closed).toBeTruthy();
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
    // Indeed's relay only reaches them inside Indeed.
    expect(missing(tech, { ...CONTACT, email: "conversation-sample-x1@indeedemail.com" }, answers)).toEqual(["Your personal email, not your Indeed address"]);
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
    expect(nextStages("interview")).toEqual(["working_interview", "owner_talk", "not_a_fit", "withdrawn"]);
    expect(nextStages("working_interview")).toEqual(["owner_talk", "not_a_fit", "withdrawn"]);
    expect(nextStages("owner_talk")).toEqual(["offer_sent", "not_a_fit", "withdrawn"]);
    // Nobody is hired before an offer goes out.
    expect(nextStages("offer_sent")).toEqual(["hired", "withdrawn"]);
    for (const s of ["video_submitted", "interview", "working_interview", "owner_talk"] as const) expect(nextStages(s)).not.toContain("hired");
    expect(nextStages("hired")).toEqual([]);
  });

  it("lets a wrongly screened-out applicant be asked for a video after all", () => {
    expect(nextStages("screened_out")).toEqual(["video_requested"]);
  });
});

describe("the Indeed ad", () => {
  const input = { business: "Sample Landscaping", area: "Harford County, MD", applyUrl: "https://example.com/careers/project-lead" };

  it("says loudly when the pay is missing, so it isn't posted without", () => {
    const unpaid = { ...lead, pay: null };
    expect(needsPay(unpaid)).toBe(true);
    expect(indeedAd(unpaid, input).body).toContain(PAY_MISSING);
    expect(needsPay({ ...affiliate, commission: null })).toBe(true);
  });

  it("has the pay for every job, hourly for the crew and commission only for the rest", () => {
    for (const p of POSITIONS) expect(needsPay(p)).toBe(false);
    const tech = payLine(positionFor("project-technician")!);
    // Leads with what a good week pays; the $15 floor reads as a guarantee, not the rate.
    expect(tech.startsWith("About $36 an hour")).toBe(true);
    expect(tech).toContain("guaranteed at least $15 an hour");
    expect(tech).not.toMatch(/share or \$15/);
    expect(payLine(lead)).toBe("$30 an hour. Commission on the jobs you complete, coming soon.");
    expect(payLine(positionFor("evaluator")!)).toBe("Paid on results (commission only, no hourly pay): 4% commission on every job you evaluate that sells.");
    expect(payLine(positionFor("account-manager")!)).toBe("Paid on results (commission only, no hourly pay): 7% commission on every job your location completes.");
    expect(indeedPayFields(lead)).toContain("Exact amount, $30.00 per hour");
    expect(indeedPayFields(positionFor("project-technician")!)).toContain("Range, $15.00 to $36.00 per hour");
    expect(indeedPayFields(affiliate)).toContain("commission only");
  });

  it("asks every commission-only applicant if that's OK, and screens out a no", () => {
    for (const p of POSITIONS.filter((x) => x.commissionOnly)) {
      const q = p.questions.find((x) => /commission only/i.test(x.label));
      expect(q?.passes).toEqual(["yes"]);
    }
  });

  it("never shows applicants the placeholder on our own page", () => {
    expect(publicPayLine(affiliate)).toBe("Paid on results (commission only, no hourly pay): 4% commission on every job that books through your link.");
    expect(publicPayLine({ ...lead, pay: null, commission: null })).toBeNull();
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
