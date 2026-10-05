import { describe, expect, it } from "vitest";

import { huntUrl, huntWords, overlap, samePost } from "@/lib/link-hunt";

describe("going back for a post's link", () => {
  const stored = "Edgewood Family\nPat Sample\nAnyone available to come cut my grass and trim my bushes today?? Preferably someone with a stand up mower.";

  it("searches the post's group for its own opening words", () => {
    const words = huntWords(stored, ["Edgewood Family", "Pat Sample"]);
    expect(words).toBe("Anyone available to come cut my grass and");
    expect(huntUrl(words, "1108487886187880")).toBe(
      "https://www.facebook.com/groups/1108487886187880/search/?q=Anyone%20available%20to%20come%20cut%20my%20grass%20and"
    );
    expect(huntUrl(words, null)).toBe("https://www.facebook.com/search/posts?q=Anyone%20available%20to%20come%20cut%20my%20grass%20and");
  });

  it("takes the post that says the same thing, and not another lawn post", () => {
    const names = ["Edgewood Family", "Pat Sample"];
    expect(samePost(stored, "Pat Sample · 2h\nAnyone available to come cut my grass and trim my bushes today?? Preferably someone with a stand up mower.", names)).toBe(true);
    expect(samePost(stored, "Does anyone know a lawn mowing company in the area? Need my grass cut this week.", names)).toBe(false);
    expect(overlap("", "anything")).toBe(0);
  });
});
