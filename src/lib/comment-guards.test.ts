import { describe, expect, it } from "vitest";

import { checkComment } from "./comment-prompt";
import { isForwarded, outsideServiceArea, pacingRefusal, posterToTag, withoutTeamMention } from "./comment-guards";

const team = ["Jace", "jordan collins", "Max", "Shalon Smith"];

const harford = {
  cities: ["Aberdeen", "Bel Air", "Edgewood", "Havre de Grace", "Joppa"],
  counties: ["Harford"],
  zips: ["21001", "21085"],
};

describe("posterToTag", () => {
  it("tags the neighbour who asked", () => {
    expect(posterToTag("Sabrina Preston", "Anyone available to cut my grass today?", team)).toBe("Sabrina Preston");
  });

  it("never tags somebody on the team", () => {
    expect(posterToTag("Jace", "Looking for a landscaper", team)).toBeNull();
    expect(posterToTag("Jace Burgess", "Hello im looking for lawn service", team)).toBeNull();
  });

  it("drops the forwarder on a post sent over Messenger", () => {
    const text = "Looking for a landscaper for a small row home\nSee Post\nEnter, Message sent Wednesday 7:11pm by Dana";
    expect(posterToTag("Dana", text, team)).toBeNull();
    expect(isForwarded(text)).toBe(true);
  });

  it("drops whoever invited us to the group", () => {
    const text = "Pat Lee invited you to join this group.\nHarford County Black Owned Businesses\nLulu Clary\nHello im looking for lawn service";
    expect(posterToTag("Pat Lee", text, team)).toBeNull();
  });

  it("tags nobody for an anonymous post", () => {
    expect(posterToTag("Anonymous member", "Looking for leaf cleanup", team)).toBeNull();
  });
});

describe("withoutTeamMention", () => {
  it("takes a teammate's tag off the front", () => {
    expect(withoutTeamMention("@Jace I'm a project technician at JS Landscaping MD.", team)).toBe("I'm a project technician at JS Landscaping MD.");
    expect(withoutTeamMention("@Jace if you haven't gotten this taken care of yet, I work with us.", team)).toMatch(/^If you haven't/);
  });

  it("leaves the neighbour's tag alone", () => {
    expect(withoutTeamMention("@April I'm a project technician.", team)).toBe("@April I'm a project technician.");
  });
});

describe("outsideServiceArea", () => {
  it("lets through a post in one of our towns", () => {
    expect(outsideServiceArea({ town: "Aberdeen", text: "Pull up annuals", markets: [harford] })).toBeNull();
    expect(outsideServiceArea({ town: "21085", text: "snow removal", markets: [harford] })).toBeNull();
    expect(outsideServiceArea({ town: "Harford County", text: "leaf clean up", markets: [harford] })).toBeNull();
  });

  it("turns away Baltimore City", () => {
    expect(outsideServiceArea({ town: null, text: "West Baltimore resident needs front and back yards cut ASAP", markets: [harford] })).toMatch(/West Baltimore/);
    expect(outsideServiceArea({ town: "Baltimore", text: "Looking for Landscaper for small yard in Baltimore", markets: [harford] })).toMatch(/Baltimore/);
  });

  it("does not turn away a post that names one of ours beside Baltimore", () => {
    expect(outsideServiceArea({ town: null, text: "Joppa, right by the Baltimore County line, need grass cut", markets: [harford] })).toBeNull();
  });

  it("lets through a post that names nowhere", () => {
    expect(outsideServiceArea({ town: null, text: "Does anyone know a lawn mowing company in the area?", markets: [harford] })).toBeNull();
  });

  it("checks nothing when no area is set", () => {
    expect(outsideServiceArea({ town: "Baltimore", text: "", markets: [] })).toBeNull();
  });
});

describe("pacingRefusal", () => {
  const now = new Date("2026-10-05T19:30:00Z");
  it("asks for a gap after a comment a minute ago", () => {
    const recent = [{ createdAt: "2026-10-05T19:29:00Z", groupName: "Edgewood Family" }];
    expect(pacingRefusal({ recent, groupName: "Harford Happenings", now })).toMatch(/Give it 4 more minutes/);
  });

  it("caps a group at two a day from one person", () => {
    const recent = [
      { createdAt: "2026-10-05T18:00:00Z", groupName: "Edgewood Family" },
      { createdAt: "2026-10-05T18:30:00Z", groupName: "Edgewood Family" },
    ];
    expect(pacingRefusal({ recent, groupName: "Edgewood Family", now })).toMatch(/already commented in Edgewood Family 2 times/);
    expect(pacingRefusal({ recent, groupName: "Harford Happenings", now })).toBeNull();
  });

  it("does not count a group name the reader made up", () => {
    const recent = [
      { createdAt: "2026-10-05T18:00:00Z", groupName: "See Post" },
      { createdAt: "2026-10-05T18:30:00Z", groupName: "See Post" },
    ];
    expect(pacingRefusal({ recent, groupName: "See Post", now })).toBeNull();
  });

  it("lets the first comment of the day through", () => {
    expect(pacingRefusal({ recent: [], groupName: "Edgewood Family", now })).toBeNull();
  });
});

describe("checkComment and timing", () => {
  it("stops a promise of a day nobody checked", () => {
    expect(checkComment("Getting your grass cut before Saturday in Joppa is no problem.").ok).toBe(false);
    expect(checkComment("We're right by Aberdeen, so getting out there fast isn't a problem.").ok).toBe(false);
    expect(checkComment("With a nice size yard we can get it cut clean the same day.").ok).toBe(false);
  });

  it("leaves ordinary wording alone", () => {
    expect(checkComment("Leaf and seasonal cleanup is one of our main services this time of year.").ok).toBe(true);
    expect(checkComment("We can keep your yard on a regular cut schedule.").ok).toBe(true);
    expect(checkComment("It will show all available dates and times so you can choose what works best.").ok).toBe(true);
  });
});
