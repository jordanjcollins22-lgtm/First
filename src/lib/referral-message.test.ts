import { describe, expect, it } from "vitest";

import { AFFILIATIONS, affiliationLabel, affiliationOf, isAffiliation, referralMessage, senderRoleOf } from "@/lib/referral-message";

const base = { name: "pat smith", link: "https://example.com/r/abc1234", business: "JS Landscaping MD", from: "Morgan Sample" };

describe("referral message", () => {
  it("carries their link and their first name for every relationship", () => {
    for (const a of AFFILIATIONS) {
      const m = referralMessage({ ...base, affiliation: a.key });
      expect(m).toContain(base.link);
      expect(m).toContain("Pat");
      expect(m).toContain("JS Landscaping MD");
    }
  });

  it("never promises a free estimate", () => {
    for (const a of AFFILIATIONS) expect(referralMessage({ ...base, affiliation: a.key }).toLowerCase()).not.toContain("free");
  });

  it("fits how they know them", () => {
    expect(referralMessage({ ...base, affiliation: "neighbor" })).toContain("It's Morgan from down the street");
    expect(referralMessage({ ...base, affiliation: "coworker" })).toContain("from work");
  });

  it("answers a message differently from a post", () => {
    const dm = referralMessage({ ...base, affiliation: "online_message" });
    const post = referralMessage({ ...base, affiliation: "online_post" });
    expect(dm).toContain("Thanks for reaching out");
    expect(dm).not.toContain("post");
    expect(post).not.toContain("saw your post");
    expect(post).toContain("glad to help with this");
    expect(dm.startsWith("Hi Pat!")).toBe(true);
    expect(post.startsWith("Hi Pat!")).toBe(true);
  });

  it("is laid out like a text: greeting alone, blank lines between parts, link on its own line", () => {
    const m = referralMessage({ ...base, affiliation: "neighbor" });
    const parts = m.split("\n\n");
    expect(parts[0]).toBe("Hey Pat!");
    expect(parts).toHaveLength(4);
    expect(m.split("\n")).toContain(base.link);
    expect(m).not.toMatch(/\n{3,}/);
  });

  it("says who the sender is by their position", () => {
    expect(referralMessage({ ...base, affiliation: "online_post", role: "owner" })).toContain("I'm the owner of JS Landscaping MD");
    expect(referralMessage({ ...base, affiliation: "online_message", role: "account-manager" })).toContain("I'm an account manager at JS Landscaping MD");
    expect(referralMessage({ ...base, affiliation: "neighbor", role: "technician" })).toContain("I'm a technician with JS Landscaping MD");
    expect(referralMessage({ ...base, affiliation: "friend", role: "affiliate" })).toContain("I work with JS Landscaping MD");
    expect(senderRoleOf(["owner"])).toBe("owner");
    expect(senderRoleOf(["account-manager", "affiliate"])).toBe("account-manager");
    expect(senderRoleOf(["project-technician"])).toBe("technician");
    expect(senderRoleOf(["affiliate"])).toBe("affiliate");
  });

  it("knows the relationships", () => {
    expect(isAffiliation("neighbor")).toBe(true);
    expect(isAffiliation("boss")).toBe(false);
    expect(affiliationLabel("online")).toBe("Someone online");
    expect(isAffiliation("online")).toBe(false);
    expect(affiliationOf("Someone online")).toBe("online_post");
    expect(affiliationOf("Messaged me online")).toBe("online_message");
    expect(affiliationOf("Neighbor")).toBe("neighbor");
    expect(affiliationOf(null)).toBe("other");
  });
});
