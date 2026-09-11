import { describe, expect, it } from "vitest";

import {
  attentionLabel,
  describeSeconds,
  sittingsFrom,
  summariseAttention,
  type AttentionEvent,
} from "@/lib/proposal-attention";

function seen(target: string, seconds: number, at: string, hash: string | null = "a"): AttentionEvent {
  return { kind: "section", target, label: null, seconds, at, visitorHash: hash };
}

function tapped(target: string, at: string, label: string | null = null, hash: string | null = "a"): AttentionEvent {
  return { kind: "click", target, label, seconds: 0, at, visitorHash: hash };
}

describe("summariseAttention", () => {
  const events: AttentionEvent[] = [
    seen("scope", 40, "2026-09-10T14:00:10Z"),
    seen("price", 95, "2026-09-10T14:01:00Z"),
    seen("scope", 25, "2026-09-10T14:03:00Z"),
    seen("terms", 1.2, "2026-09-10T14:04:00Z"),
    tapped("ask-about-area", "2026-09-10T14:02:00Z", "Back fence"),
    tapped("ask-about-area", "2026-09-10T14:02:40Z", "Back fence"),
    tapped("photo", "2026-09-10T14:03:30Z", "Front bed"),
  ];

  it("ranks what they read by how long, not by where it sits on the page", () => {
    const summary = summariseAttention(events);
    expect(summary.read.map((line) => line.target)).toEqual(["price", "scope"]);
    expect(summary.focus?.target).toBe("price");
  });

  it("adds up the times a section came back on screen", () => {
    const scope = summariseAttention(events).read.find((line) => line.target === "scope")!;
    expect(scope.seconds).toBe(65);
    expect(scope.times).toBe(2);
  });

  it("drops a section that was only scrolled past", () => {
    // A page flicked top to bottom shows everything for a moment. Listing
    // those reads as "they looked at this briefly", which is a stronger claim
    // than a glance supports.
    expect(summariseAttention(events).read.map((l) => l.target)).not.toContain("terms");
  });

  it("shares add up to the whole", () => {
    const summary = summariseAttention(events);
    const total = summary.read.reduce((sum, line) => sum + line.share, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(summary.totalSeconds).toBe(160);
  });

  it("counts a click per press and remembers the last one", () => {
    const clicks = summariseAttention(events).clicks;
    expect(clicks[0]).toMatchObject({ target: "ask-about-area", count: 2, label: "Back fence" });
    expect(clicks[0].lastAt).toBe("2026-09-10T14:02:40Z");
  });

  it("uses the section's own name when the event carried none", () => {
    expect(summariseAttention([seen("price", 30, "2026-09-10T14:00:00Z")]).read[0].label).toBe(
      "The price"
    );
  });

  it("keeps an unknown target rather than dropping it", () => {
    const summary = summariseAttention([seen("something-new", 30, "2026-09-10T14:00:00Z")]);
    expect(summary.read[0].label).toBe("something-new");
  });

  it("says so when there is too little to draw a conclusion from", () => {
    const glance = summariseAttention([seen("price", 6, "2026-09-10T14:00:00Z")]);
    expect(glance.thin).toBe(true);
    expect(summariseAttention(events).thin).toBe(false);
  });

  it("has nothing to say about a proposal nobody opened", () => {
    const summary = summariseAttention([]);
    expect(summary.read).toEqual([]);
    expect(summary.focus).toBeNull();
    expect(summary.totalSeconds).toBe(0);
  });

  it("does not divide by nothing when every section was a glance", () => {
    const summary = summariseAttention([seen("price", 0.5, "2026-09-10T14:00:00Z")]);
    expect(summary.totalSeconds).toBe(0);
    expect(summary.read).toEqual([]);
  });
});

describe("attentionLabel", () => {
  it("opens the phone call with what they were stuck on", () => {
    const summary = summariseAttention([
      seen("price", 95, "2026-09-10T14:00:00Z"),
      seen("scope", 30, "2026-09-10T14:02:00Z"),
    ]);
    expect(attentionLabel(summary)).toBe("Most time on the price (1m 35s)");
  });

  it("refuses to name a favourite out of a bounce", () => {
    expect(attentionLabel(summariseAttention([seen("price", 6, "2026-09-10T14:00:00Z")]))).toBe(
      "Opened, but barely read"
    );
  });

  it("says nothing rather than something when nothing happened", () => {
    expect(attentionLabel(summariseAttention([]))).toBe("Nothing read yet");
  });
});

describe("sittingsFrom", () => {
  it("groups one visit together and puts the newest first", () => {
    const sittings = sittingsFrom([
      seen("scope", 30, "2026-09-08T10:00:00Z"),
      seen("price", 40, "2026-09-08T10:01:00Z"),
      seen("scope", 50, "2026-09-10T14:00:00Z"),
    ]);
    expect(sittings).toHaveLength(2);
    expect(sittings[0].startedAt).toBe("2026-09-10T14:00:00Z");
  });

  it("starts a new sitting after a long gap", () => {
    const sittings = sittingsFrom([
      seen("price", 30, "2026-09-10T14:00:00Z"),
      seen("price", 30, "2026-09-10T15:31:00Z"),
    ]);
    expect(sittings).toHaveLength(2);
  });

  it("keeps two people on one proposal apart even at the same moment", () => {
    const sittings = sittingsFrom([
      seen("price", 30, "2026-09-10T14:00:00Z", "him"),
      seen("scope", 30, "2026-09-10T14:00:30Z", "her"),
    ]);
    expect(sittings).toHaveLength(2);
    expect(new Set(sittings.map((s) => s.visitorHash))).toEqual(new Set(["him", "her"]));
  });

  it("says what each sitting was mostly about", () => {
    const sittings = sittingsFrom([
      seen("scope", 20, "2026-09-10T14:00:00Z"),
      seen("price", 90, "2026-09-10T14:01:00Z"),
      tapped("accept", "2026-09-10T14:03:00Z"),
    ]);
    expect(sittings[0].focus).toBe("The price");
    expect(sittings[0].clicks).toBe(1);
  });

  it("has nothing to group with no events", () => {
    expect(sittingsFrom([])).toEqual([]);
  });
});

describe("describeSeconds", () => {
  it("speaks the way somebody would", () => {
    expect(describeSeconds(45)).toBe("45s");
    expect(describeSeconds(95)).toBe("1m 35s");
    expect(describeSeconds(600)).toBe("10m");
    expect(describeSeconds(660)).toBe("11m");
  });
});
