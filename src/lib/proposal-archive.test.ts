import { describe, expect, it } from "vitest";

import {
  ACCEPTED_TYPES,
  MAX_FILE_BYTES,
  OUTCOMES,
  archiveLine,
  byJobDate,
  checkArchiveFile,
  extensionFor,
  isOutcome,
  outcomeLabel,
  summariseArchive,
  type ArchivedProposal,
} from "./proposal-archive";

function row(over: Partial<ArchivedProposal> = {}): ArchivedProposal {
  return {
    id: "a1",
    filePath: "org/cust/a1.pdf",
    fileName: "Backyard quote.pdf",
    outcome: "won",
    jobDate: "2025-04-12",
    title: "Back garden rebuild",
    amount: 4200,
    notes: null,
    ...over,
  };
}

describe("the outcomes", () => {
  it("are the three things that actually happened to a quote", () => {
    expect(OUTCOMES.map((o) => o.value)).toEqual(["won", "lost", "disputed"]);
    expect(isOutcome("won")).toBe(true);
    expect(isOutcome("pending")).toBe(false);
  });

  it("read as somebody would say them out loud", () => {
    expect(outcomeLabel("won")).toBe("We got it");
    expect(outcomeLabel("lost")).toBe("We didn't get it");
  });

  it("says so rather than showing a raw value it does not know", () => {
    expect(outcomeLabel("something_else")).toBe("Unknown");
    expect(outcomeLabel(null)).toBe("Unknown");
  });
});

describe("checkArchiveFile", () => {
  it("takes a PDF, which is what the old system exports", () => {
    expect(checkArchiveFile({ type: "application/pdf", size: 400_000 }).ok).toBe(true);
  });

  it("takes a photo of a paper quote", () => {
    for (const type of ["image/png", "image/jpeg"]) {
      expect(checkArchiveFile({ type, size: 400_000 }).ok).toBe(true);
    }
  });

  it("refuses something that is not a document", () => {
    const check = checkArchiveFile({ type: "video/mp4", size: 400_000 });
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/PDF/);
  });

  it("says both things when both are wrong", () => {
    // Somebody archiving a year of work should not fix one fault per round
    // trip to find out about the next.
    const check = checkArchiveFile({ type: "video/mp4", size: 99 * 1024 * 1024 });
    expect(check.message).toMatch(/PDF/);
    expect(check.message).toMatch(/limit/);
  });

  it("catches an empty file, which a phone share sheet produces", () => {
    expect(checkArchiveFile({ type: "application/pdf", size: 0 }).ok).toBe(false);
  });

  it("leaves room for a scanned multi-page quote", () => {
    expect(MAX_FILE_BYTES).toBeGreaterThanOrEqual(20 * 1024 * 1024);
    expect(ACCEPTED_TYPES).toContain("application/pdf");
  });
});

describe("extensionFor", () => {
  it("stores it under what it actually is", () => {
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("summariseArchive", () => {
  it("counts what happened", () => {
    const summary = summariseArchive([
      row(),
      row({ id: "a2", outcome: "lost" }),
      row({ id: "a3", outcome: "lost" }),
      row({ id: "a4", outcome: "disputed" }),
    ]);
    expect(summary).toMatchObject({ total: 4, won: 1, lost: 2, disputed: 1 });
  });

  it("adds up only what was won, in cents", () => {
    const summary = summariseArchive([row({ amount: 4200 }), row({ id: "a2", outcome: "lost", amount: 9000 })]);
    expect(summary.wonValueCents).toBe(420_000);
  });

  it("tells no value apart from no amounts entered", () => {
    // Nothing entered is not the same as the work being worth nothing.
    expect(summariseArchive([row({ amount: null })]).wonValueCents).toBeNull();
  });

  it("is empty for a client with nothing on file", () => {
    expect(summariseArchive([])).toMatchObject({ total: 0, wonValueCents: null });
  });
});

describe("archiveLine", () => {
  it("says what is there in one line", () => {
    const line = archiveLine(summariseArchive([row(), row({ id: "a2", outcome: "lost" })]));
    expect(line).toBe("2 older quotes — 1 won, 1 lost.");
  });

  it("is singular when it is one", () => {
    expect(archiveLine(summariseArchive([row()]))).toBe("1 older quote — 1 won.");
  });

  it("says plainly when there is nothing", () => {
    expect(archiveLine(summariseArchive([]))).toBe("No older quotes on file.");
  });
});

describe("byJobDate", () => {
  it("puts the most recent job first", () => {
    const sorted = byJobDate([
      row({ id: "old", jobDate: "2024-01-01" }),
      row({ id: "new", jobDate: "2026-01-01" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("puts an undated one last, where it can be seen and finished", () => {
    const sorted = byJobDate([row({ id: "undated", jobDate: null }), row({ id: "dated" })]);
    expect(sorted.map((r) => r.id)).toEqual(["dated", "undated"]);
  });

  it("does not disturb the list it was given", () => {
    const rows = [row({ id: "a" }), row({ id: "b", jobDate: "2026-01-01" })];
    byJobDate(rows);
    expect(rows[0].id).toBe("a");
  });
});
