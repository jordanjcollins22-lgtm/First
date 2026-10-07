import { describe, expect, it } from "vitest";

import { readingBrief, readingSystemPrompt, readPost } from "@/lib/post-reading";

const SERVICES = ["Lawn Care", "Leaf / Seasonal Cleanup"];

describe("readingSystemPrompt", () => {
  it("names the business's own services, so a lead lands on something sellable", () => {
    const prompt = readingSystemPrompt({ groupName: "Bel Air South", services: SERVICES, blockWords: [] });
    expect(prompt).toContain("Leaf / Seasonal Cleanup");
    expect(prompt).toContain("Bel Air South");
  });

  it("asks the picture for the group when we do not already know it", () => {
    const prompt = readingSystemPrompt({ groupName: "", services: [], blockWords: [] });
    expect(prompt).toContain("Nextdoor");
    expect(prompt).toContain("written above the post");
  });

  it("errs toward calling a post a request, because the other mistake costs a member", () => {
    const prompt = readingSystemPrompt({ groupName: "G", services: [], blockWords: [] });
    expect(prompt.toLowerCase()).toContain("when you are unsure");
  });
});

describe("readingBrief", () => {
  it("says the post is in the picture when there is no text", () => {
    expect(readingBrief({ pastedText: "  ", note: "" })).toContain("in the image");
  });

  it("carries the pasted words through", () => {
    expect(readingBrief({ pastedText: "leaves everywhere", note: "" })).toContain("leaves everywhere");
  });
});

describe("readPost", () => {
  it("pulls every field off a screenshot so nobody types them", () => {
    const out = readPost(
      JSON.stringify({
        kind: "request",
        service: "Lawn Care",
        urgency: "soon",
        author: "Dana Whitfield",
        summary: "Wants the lawn cut before a party.",
        matched: [],
        platform: "facebook",
        group: "Bel Air South Neighbours",
        age_days: 2,
      }),
      SERVICES
    );
    expect(out?.kind).toBe("request");
    expect(out?.service).toBe("Lawn Care");
    expect(out?.urgency).toBe("soon");
    expect(out?.author).toBe("Dana");
    expect(out?.platform).toBe("facebook");
    expect(out?.groupName).toBe("Bel Air South Neighbours");
    expect(out?.ageDays).toBe(2);
  });

  it("reads it out of a code fence", () => {
    expect(readPost('```json\n{"kind":"other","summary":"chat"}\n```', SERVICES)?.kind).toBe("other");
  });

  it("reads it out of a sentence the model added anyway", () => {
    const out = readPost('Here you go: {"kind":"promotion","matched":["now booking"]}', SERVICES);
    expect(out?.kind).toBe("promotion");
    expect(out?.matchedWords).toEqual(["now booking"]);
  });

  it("spells the service the way the business does", () => {
    expect(readPost('{"kind":"request","service":"lawn care"}', SERVICES)?.service).toBe("Lawn Care");
  });

  it("drops a service nobody sells rather than inventing a category", () => {
    expect(readPost('{"kind":"request","service":"Roof Replacement"}', SERVICES)?.service).toBeNull();
  });

  it("gives back nothing when the answer will not parse, so the caller keeps its own reading", () => {
    expect(readPost("I think this person wants their lawn cut.", SERVICES)).toBeNull();
    expect(readPost("", SERVICES)).toBeNull();
  });

  it("refuses a kind it does not know", () => {
    expect(readPost('{"kind":"maybe"}', SERVICES)).toBeNull();
  });

  it("keeps no service or urgency on a post that is not a request", () => {
    const out = readPost('{"kind":"other","service":"Lawn Care","urgency":"soon"}', SERVICES);
    expect(out?.service).toBeNull();
    expect(out?.urgency).toBeNull();
  });

  it("keeps matched words only where they mean something", () => {
    expect(readPost('{"kind":"request","matched":["free estimates"]}', SERVICES)?.matchedWords).toEqual([]);
  });

  it("drops a platform it does not know rather than guessing one", () => {
    expect(readPost('{"kind":"other","platform":"mastodon"}', SERVICES)?.platform).toBeNull();
  });

  it("drops a group name long enough to be the whole header", () => {
    const out = readPost(JSON.stringify({ kind: "other", group: "x".repeat(200) }), SERVICES);
    expect(out?.groupName).toBeNull();
  });

  it("tidies the spacing in a group name, so the tally does not split in two", () => {
    const out = readPost('{"kind":"other","group":"  Bel Air   South  "}', SERVICES);
    expect(out?.groupName).toBe("Bel Air South");
  });

  it("takes an age of zero for a post from this morning", () => {
    expect(readPost('{"kind":"request","age_days":0}', SERVICES)?.ageDays).toBe(0);
  });

  it("drops a nonsense age rather than pretending to know", () => {
    expect(readPost('{"kind":"request","age_days":-4}', SERVICES)?.ageDays).toBeNull();
    expect(readPost('{"kind":"request","age_days":"ages"}', SERVICES)?.ageDays).toBeNull();
  });
});
