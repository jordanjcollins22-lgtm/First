import { describe, expect, it } from "vitest";
import { heardAboutAnswer, heardAboutProblem } from "./heard-about";

describe("heardAboutAnswer", () => {
  it("keeps one of the options as it is", () => {
    expect(heardAboutAnswer("Nextdoor")).toBe("Nextdoor");
    expect(heardAboutAnswer(" Google search ")).toBe("Google search");
  });

  it("refuses a blank or made-up answer", () => {
    expect(heardAboutAnswer("")).toBeNull();
    expect(heardAboutAnswer(null)).toBeNull();
    expect(heardAboutAnswer("TikTok")).toBeNull();
  });

  it("needs words with Other, and keeps them short", () => {
    expect(heardAboutAnswer("Other")).toBeNull();
    expect(heardAboutAnswer("Other", "   ")).toBeNull();
    expect(heardAboutAnswer("Other", "  church   bulletin ")).toBe("Other: church bulletin");
    expect(heardAboutAnswer("Other", "x".repeat(200))).toBe(`Other: ${"x".repeat(80)}`);
  });
});

describe("heardAboutProblem", () => {
  it("asks for an answer when there is none", () => {
    expect(heardAboutProblem("")).toBe("Tell us how you heard about us.");
  });

  it("asks for the words when Other has none", () => {
    expect(heardAboutProblem("Other", "")).toBe("Tell us where you heard about us.");
  });

  it("is happy with a real answer", () => {
    expect(heardAboutProblem("Facebook")).toBeNull();
    expect(heardAboutProblem("Other", "radio")).toBeNull();
  });
});
