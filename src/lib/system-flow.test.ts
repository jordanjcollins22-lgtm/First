import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SYSTEM_FLOW } from "@/lib/system-flow";

/** Whether a link lands on a page that exists, under (app) or at the top. */
function pageExists(href: string): boolean {
  const route = href.split("?")[0];
  const app = path.join(process.cwd(), "src/app");
  return [path.join(app, "(app)", route, "page.tsx"), path.join(app, route, "page.tsx")].some((f) => existsSync(f));
}

describe("the system map", () => {
  const squares = SYSTEM_FLOW.flatMap((s) => s.squares);

  it("runs in the order a customer meets the business", () => {
    expect(SYSTEM_FLOW.map((s) => s.key)).toEqual(["marketing", "win", "work"]);
    expect(squares.filter((s) => !SYSTEM_FLOW[0].squares.includes(s)).map((s) => s.key)).toEqual([
      "booking",
      "prep",
      "evaluation",
      "pricing",
      "proposal",
      "crew-sheet",
      "field",
      "client-approval",
    ]);
  });

  it("opens a page that exists from every square that has one", () => {
    for (const square of squares) {
      if (square.href) expect(pageExists(square.href), `${square.title}: ${square.href}`).toBe(true);
    }
  });

  it("says what is missing wherever it is not all live, and links nowhere when nothing is built", () => {
    for (const square of squares) {
      if (square.status !== "live") expect(square.gap, square.title).toBeTruthy();
      if (square.status === "not-built") expect(square.href).toBeNull();
    }
  });

  it("has unique keys and no dashes in what it says", () => {
    expect(new Set(squares.map((s) => s.key)).size).toBe(squares.length);
    for (const s of squares) expect(`${s.title} ${s.line} ${s.gap ?? ""}`).not.toMatch(/[–—]/);
  });
});
