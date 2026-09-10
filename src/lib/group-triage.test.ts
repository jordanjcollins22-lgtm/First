import { describe, expect, it } from "vitest";

import { readTriage, triageBrief, triageSystemPrompt } from "@/lib/group-triage";

const SERVICES = ["Lawn Care", "Leaf / Seasonal Cleanup"];

describe("triageSystemPrompt", () => {
  it("names the group's own services, so a lead lands on something sellable", () => {
    const prompt = triageSystemPrompt({ groupName: "Bel Air South", services: SERVICES, blockWords: [] });
    expect(prompt).toContain("Leaf / Seasonal Cleanup");
    expect(prompt).toContain("Bel Air South");
  });

  it("errs toward calling a post a request, because the other mistake costs a member", () => {
    const prompt = triageSystemPrompt({ groupName: "G", services: [], blockWords: [] });
    expect(prompt.toLowerCase()).toContain("when you are unsure");
  });
});

describe("triageBrief", () => {
  it("says the post is in the picture when there is no text", () => {
    expect(triageBrief({ pastedText: "  ", note: "" })).toContain("in the image");
  });

  it("carries the pasted words through", () => {
    expect(triageBrief({ pastedText: "leaves everywhere", note: "" })).toContain("leaves everywhere");
  });
});

describe("readTriage", () => {
  it("reads a plain object", () => {
    const out = readTriage(
      JSON.stringify({
        kind: "request",
        service: "Lawn Care",
        urgency: "soon",
        author: "Dana Whitfield",
        summary: "Wants the lawn cut before a party.",
        matched: [],
      }),
      SERVICES
    );
    expect(out?.kind).toBe("request");
    expect(out?.service).toBe("Lawn Care");
    expect(out?.urgency).toBe("soon");
    expect(out?.author).toBe("Dana");
  });

  it("reads it out of a code fence", () => {
    const out = readTriage('```json\n{"kind":"other","summary":"chat"}\n```', SERVICES);
    expect(out?.kind).toBe("other");
  });

  it("reads it out of a sentence the model added anyway", () => {
    const out = readTriage('Here you go: {"kind":"promotion","matched":["now booking"]}', SERVICES);
    expect(out?.kind).toBe("promotion");
    expect(out?.matchedWords).toEqual(["now booking"]);
  });

  it("spells the service the way the business does", () => {
    const out = readTriage('{"kind":"request","service":"lawn care"}', SERVICES);
    expect(out?.service).toBe("Lawn Care");
  });

  it("drops a service nobody sells rather than inventing a category", () => {
    const out = readTriage('{"kind":"request","service":"Roof Replacement"}', SERVICES);
    expect(out?.service).toBeNull();
  });

  it("gives back nothing when the answer will not parse, so the caller keeps its own reading", () => {
    expect(readTriage("I think this person wants their lawn cut.", SERVICES)).toBeNull();
    expect(readTriage("", SERVICES)).toBeNull();
  });

  it("refuses a kind it does not know", () => {
    expect(readTriage('{"kind":"maybe"}', SERVICES)).toBeNull();
  });

  it("keeps no service or urgency on a post that is not a request", () => {
    const out = readTriage('{"kind":"other","service":"Lawn Care","urgency":"soon"}', SERVICES);
    expect(out?.service).toBeNull();
    expect(out?.urgency).toBeNull();
  });

  it("keeps matched words only where they mean something", () => {
    const out = readTriage('{"kind":"request","matched":["free estimates"]}', SERVICES);
    expect(out?.matchedWords).toEqual([]);
  });
});
