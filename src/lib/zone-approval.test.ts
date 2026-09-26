import { describe, expect, it } from "vitest";

import { approvalPolicy, approvalQueue, approvalStreak, approvedShape, describeTrust, summarizeApprovals, trustLevel, worstFault, type WalkFault, type ZoneApprovalRow, type ZoneReview } from "./zone-approval";

function zone(over: Partial<ZoneApprovalRow>): ZoneApprovalRow {
  return { id: "z", name: "21014 C001", approval: "pending", needsApproval: true, mode: "foot", houses: 400, gapM: 20, pathKm: 8, minutes: 300, isPart: false, active: false, approvedAt: null, note: null, ...over };
}
function review(over: Partial<ZoneReview>): ZoneReview {
  return { zoneId: "z", zoneName: "21014 C001", decision: "approve", reason: null, note: null, mode: "foot", newMode: null, houses: 400, gapM: 20, pathKm: 8, at: "2026-09-06T10:00:00Z", ...over };
}

describe("the streak", () => {
  it("counts a person's approvals since the last correction, not the app's", () => {
    expect(approvalStreak([review({}), review({ decision: "auto" }), review({}), review({ decision: "reject" }), review({})])).toBe(2);
    expect(approvalStreak([])).toBe(0);
    expect(trustLevel(9)).toBe("ask_all");
    expect(trustLevel(10)).toBe("ask_unusual");
    expect(trustLevel(25)).toBe("ask_exceptional");
  });
});

describe("the policy", () => {
  const shape = approvedShape([review({ houses: 300, gapM: 15 }), review({ houses: 600, gapM: 30 }), review({ mode: "vehicle", houses: 200, gapM: 120 })]);
  it("asks about everything while learning", () => {
    expect(approvalPolicy(zone({}), shape, "ask_all").decision).toBe("ask");
  });
  it("approves zones like the approved ones and asks about the unusual", () => {
    expect(approvalPolicy(zone({ houses: 450, gapM: 22 }), shape, "ask_unusual")).toEqual({ decision: "auto", why: "like the foot zones already approved" });
    expect(approvalPolicy(zone({ mode: "scooter" }), shape, "ask_unusual").why).toMatch(/no scooter zone/);
    expect(approvalPolicy(zone({ houses: 1200 }), shape, "ask_unusual").why).toMatch(/more doors/);
    expect(approvalPolicy(zone({ gapM: 60 }), shape, "ask_unusual").why).toMatch(/further apart/);
    expect(approvalPolicy(zone({ isPart: true }), shape, "ask_unusual").why).toMatch(/split off/);
  });
  it("is twice as forgiving once trust is established, and lets parts through", () => {
    expect(approvalPolicy(zone({ houses: 1100, isPart: true }), shape, "ask_exceptional").decision).toBe("auto");
    expect(approvalPolicy(zone({ houses: 1300 }), shape, "ask_exceptional").decision).toBe("ask");
  });
});

describe("the queue and the words", () => {
  it("puts the zones with our work in them first, then the biggest", () => {
    const q = approvalQueue([zone({ id: "a", houses: 900 }), zone({ id: "b", houses: 100, active: true }), zone({ id: "c", needsApproval: false }), zone({ id: "d", houses: 950 })]);
    expect(q.map((z) => z.id)).toEqual(["b", "d", "a"]);
  });
  it("counts and describes", () => {
    expect(summarizeApprovals([zone({ needsApproval: false, approval: "approved" }), zone({ needsApproval: false, approval: "auto" }), zone({}), zone({ approval: "rejected" })])).toEqual({ approved: 2, byPerson: 1, byApp: 1, waiting: 2, rejected: 1 });
    expect(describeTrust(3)).toMatch(/after 7 more/);
    expect(describeTrust(12)).toMatch(/only unusual/);
    expect(describeTrust(30)).toMatch(/exceptional/);
  });
});

describe("a route that could hurt somebody is never approved on the app's own say-so", () => {
  const shape = approvedShape([
    { zoneId: "a", zoneName: "A", decision: "approve", reason: null, note: null, mode: "foot", newMode: null, houses: 400, gapM: 30, pathKm: 12, at: "2026-01-01" },
  ]);

  const crossing: WalkFault = {
    kind: "unsafe_crossing",
    severity: "bad",
    count: 34,
    says: "The round crosses Pulaski Highway on foot 34 times.",
  };

  it("asks about a bad route however much trust there is", () => {
    for (const level of ["ask_unusual", "ask_exceptional"] as const) {
      const policy = approvalPolicy(
        zone({ mode: "foot", houses: 400, gapM: 30, quality: "bad", faults: [crossing] }),
        shape,
        level
      );
      expect(policy.decision).toBe("ask");
      expect(policy.why).toBe("The round crosses Pulaski Highway on foot 34 times.");
    }
  });

  it("would have approved the very same zone without the fault", () => {
    // Doors and spacing are exactly what the learning approves. The fault
    // report is the only thing that can tell the two apart.
    const policy = approvalPolicy(zone({ mode: "foot", houses: 400, gapM: 30 }), shape, "ask_exceptional");
    expect(policy.decision).toBe("auto");
  });

  it("puts the dangerous fault first when a zone has several", () => {
    const policy = approvalPolicy(
      zone({
        mode: "foot",
        houses: 400,
        gapM: 30,
        quality: "bad",
        faults: [
          { kind: "disconnected", severity: "bad", count: 4, says: "The round is in 5 pieces." },
          crossing,
        ],
      }),
      shape,
      "ask_exceptional"
    );
    expect(policy.why).toBe("The round crosses Pulaski Highway on foot 34 times.");
  });

  it("does not stop an approval for a fault that only wastes a morning", () => {
    const policy = approvalPolicy(
      zone({
        mode: "foot",
        houses: 400,
        gapM: 30,
        quality: "check",
        faults: [{ kind: "doors_not_passed", severity: "check", count: 108, says: "108 doors are off the line." }],
      }),
      shape,
      "ask_exceptional"
    );
    expect(policy.decision).toBe("auto");
  });

  it("says nothing about a zone walked before the check existed", () => {
    expect(worstFault(zone({ quality: null }))).toBeNull();
    expect(worstFault(zone({ quality: "unknown" }))).toBeNull();
  });
});
