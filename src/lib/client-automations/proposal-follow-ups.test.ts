import { describe, expect, it } from "vitest";

import { followUpMessage, followUpPlan, followUpStop, followUpsDue } from "@/lib/client-automations/proposal-follow-ups";

const sentAt = new Date("2026-10-01T15:00:00Z");
const plan = followUpPlan([3, 7, 14, 21, 30]);
const facts = (over: Partial<Parameters<typeof followUpStop>[0]> = {}) => ({ status: "sent", sentAt, expiresAt: null, lastClientContactAt: null, ...over });

describe("followUpPlan", () => {
  it("is five touches, email and text in turn", () => {
    expect(plan.map((t) => `${t.offsetHours / 24}:${t.channel}`)).toEqual(["3:email", "7:sms", "14:email", "21:sms", "30:email"]);
  });
});

describe("followUpStop", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  it("runs while nothing has happened", () => {
    expect(followUpStop(facts(), now)).toBeNull();
  });
  it("stops on accept, decline or expiry", () => {
    expect(followUpStop(facts({ status: "accepted" }), now)).toBe("answered");
    expect(followUpStop(facts({ status: "declined" }), now)).toBe("answered");
    expect(followUpStop(facts({ expiresAt: new Date("2026-10-08T00:00:00Z") }), now)).toBe("expired");
  });
  it("stops on a reply after it went, not one from before", () => {
    expect(followUpStop(facts({ lastClientContactAt: new Date("2026-10-02T10:00:00Z") }), now)).toBe("replied");
    expect(followUpStop(facts({ lastClientContactAt: new Date("2026-09-20T10:00:00Z") }), now)).toBeNull();
  });
});

describe("followUpsDue", () => {
  it("sends each touch on its day, inside the late window", () => {
    const due = (iso: string, f = facts()) => followUpsDue({ facts: f, plan, now: new Date(iso) }).map((t) => `${t.offsetHours}:${t.channel}`);
    expect(due("2026-10-04T16:00:00Z")).toEqual(["72:email"]);
    expect(due("2026-10-08T15:30:00Z")).toEqual(["168:sms"]);
    expect(due("2026-10-10T15:30:00Z")).toEqual([]);
    expect(due("2026-10-31T15:30:00Z")).toEqual(["720:email"]);
  });

  it("sends nothing once the client has replied", () => {
    const f = facts({ lastClientContactAt: new Date("2026-10-05T09:00:00Z") });
    expect(followUpsDue({ facts: f, plan, now: new Date("2026-10-08T15:30:00Z") })).toEqual([]);
  });
});

describe("followUpMessage", () => {
  it("says something different each time and carries the link", () => {
    const words = [0, 1, 2, 3, 4].map((index) =>
      followUpMessage({ index, channel: "email", businessName: "JS", clientName: "Ann Lee", address: "1 Main St", link: "https://x/proposal/t" }).body.split("\n\n")[0]
    );
    expect(new Set(words).size).toBe(5);
    expect(followUpMessage({ index: 1, channel: "sms", businessName: "JS", clientName: "Ann", address: null, link: "https://x/p", includeOptOut: true }).body).toMatch(/^JS: Hi Ann, .*https:\/\/x\/p Reply STOP to stop\.$/);
  });
});
