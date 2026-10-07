import { describe, expect, it } from "vitest";

import { LINK_MARKER } from "./comment-prompt";
import { parseReadAndDraft, readAndDraftSystemPrompt } from "./read-and-draft";

describe("readAndDraftSystemPrompt", () => {
  it("asks for the reading and the words in one object", () => {
    const prompt = readAndDraftSystemPrompt({
      reading: { groupName: "", services: ["Mulching"], blockWords: [] },
      writing: "Be brief.",
      what: "comment",
    });
    expect(prompt).toContain('"kind": "request"');
    expect(prompt).toContain(`"comment": the finished comment`);
    expect(prompt).toContain(LINK_MARKER);
    expect(prompt).toContain("Be brief.");
  });
});

describe("parseReadAndDraft", () => {
  it("takes the reading and the comment out of the same answer", () => {
    const raw = JSON.stringify({
      kind: "request",
      service: "Mulching",
      urgency: "soon",
      author: "Linda Holden",
      summary: "Wants beds mulched before a party.",
      matched: [],
      platform: "facebook",
      group: "Bel Air Community",
      age_days: 2,
      comment: `Hi Linda, I operate JS Landscaping MD. ${LINK_MARKER} Happy to help!`,
    });
    const out = parseReadAndDraft(raw, ["Mulching"], "comment");
    expect(out.reading?.service).toBe("Mulching");
    expect(out.reading?.author).toBe("Linda");
    expect(out.reading?.groupName).toBe("Bel Air Community");
    expect(out.comment).toContain(LINK_MARKER);
  });

  it("gives no comment for an advert, and no reading for nonsense", () => {
    const advert = parseReadAndDraft(JSON.stringify({ kind: "promotion", summary: "An ad", matched: ["DM me"], comment: null }), [], "comment");
    expect(advert.reading?.kind).toBe("promotion");
    expect(advert.comment).toBeNull();
    expect(parseReadAndDraft("not json", [], "comment")).toEqual({ reading: null, comment: null });
  });
});
