import { describe, expect, it } from "vitest";
import { affiliateSplit, channelBudgets } from "./channel-budget";

const src = (group: string) => ({ group, detail: null });

describe("channel growth budget", () => {
  it("puts 4% of what the client paid into the channel when nobody brought the job in", () => {
    expect(channelBudgets([{ source: src("Google ad"), collected: 5000, hasAffiliate: false }])).toEqual([
      { group: "Google ad", jobs: 1, collected: 5000, budget: 200 },
    ]);
  });

  it("pays the affiliate instead when a person brought the job in", () => {
    expect(channelBudgets([{ source: src("Flyer"), collected: 5000, hasAffiliate: true }])).toEqual([]);
  });

  it("counts only money the client actually paid", () => {
    expect(channelBudgets([{ source: src("Yard sign"), collected: 0, hasAffiliate: false }])).toEqual([]);
    expect(channelBudgets([{ source: src("Yard sign"), collected: 1234.5, hasAffiliate: false }])[0].budget).toBe(49.38);
  });

  it("adds up each channel and lists the biggest budget first", () => {
    const rows = channelBudgets([
      { source: src("Flyer"), collected: 1000, hasAffiliate: false },
      { source: src("Google ad"), collected: 3000, hasAffiliate: false },
      { source: src("Flyer"), collected: 500, hasAffiliate: false },
    ]);
    expect(rows.map((r) => [r.group, r.jobs, r.budget])).toEqual([
      ["Google ad", 1, 120],
      ["Flyer", 2, 60],
    ]);
  });

  it("puts a calendar booking under what the client said brought them", () => {
    expect(channelBudgets([{ source: { group: "GoHighLevel calendar", detail: "Google" }, collected: 1000, hasAffiliate: false }])[0].group).toBe(
      "Google (client said)"
    );
  });
});

describe("affiliate 4% split", () => {
  it("pays a person for jobs they brought in and sends every other job's 4% to its channel", () => {
    const split = affiliateSplit([
      { source: src("Facebook comment"), collected: 2000, hasAffiliate: true, affiliate: "Jace" },
      { source: src("Nextdoor comment"), collected: 500, hasAffiliate: true, affiliate: "Jace" },
      { source: src("Facebook comment"), collected: 0, hasAffiliate: true, affiliate: "Sam" },
      { source: src("Facebook ad"), collected: 1000, hasAffiliate: false },
      { source: src("Instagram post"), collected: 0, hasAffiliate: false },
    ]);
    expect(split.peopleLeads).toBe(3);
    expect(split.sourceLeads).toBe(2);
    expect(split.people).toEqual([{ name: "Jace", jobs: 2, collected: 2500, cut: 100 }]);
    expect(split.sources).toEqual([{ group: "Facebook ad", jobs: 1, collected: 1000, budget: 40 }]);
  });
});

