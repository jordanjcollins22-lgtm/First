import { describe, expect, it } from "vitest";

import { boundedPageSize, fetchAllRows, takePage } from "./pagination";

describe("boundedPageSize", () => {
  it("uses the caller's number when it is a sensible one", () => {
    expect(boundedPageSize(120, 50, 500)).toBe(120);
  });

  it("falls back when nothing was asked for", () => {
    expect(boundedPageSize(undefined, 50, 500)).toBe(50);
    expect(boundedPageSize(null, 50, 500)).toBe(50);
  });

  it("reads the number out of a query string", () => {
    expect(boundedPageSize("100", 50, 500)).toBe(100);
    expect(boundedPageSize(" 100 ", 50, 500)).toBe(100);
  });

  it("caps a request for the whole table", () => {
    // The point of the cap: a URL is something anybody can edit, and without
    // this "?show=999999" is a way to ask for every row there has ever been.
    expect(boundedPageSize(999_999, 50, 500)).toBe(500);
    expect(boundedPageSize("999999", 50, 500)).toBe(500);
  });

  it("falls back rather than failing on something that is not a number", () => {
    // A mistyped URL should show the first page, not an error page.
    expect(boundedPageSize("all", 50, 500)).toBe(50);
    expect(boundedPageSize("", 50, 500)).toBe(50);
    expect(boundedPageSize(Number.NaN, 50, 500)).toBe(50);
    expect(boundedPageSize(Number.POSITIVE_INFINITY, 50, 500)).toBe(50);
  });

  it("falls back on zero and negatives, which would ask for nothing", () => {
    expect(boundedPageSize(0, 50, 500)).toBe(50);
    expect(boundedPageSize(-10, 50, 500)).toBe(50);
  });

  it("rounds a fractional request down to a whole page", () => {
    expect(boundedPageSize(12.9, 50, 500)).toBe(12);
  });
});

describe("takePage", () => {
  it("says there is more when the extra row came back", () => {
    // Four rows asked for, five returned: the fifth exists only to answer
    // this question and is not shown.
    const { items, hasMore } = takePage([1, 2, 3, 4, 5], 4);
    expect(items).toEqual([1, 2, 3, 4]);
    expect(hasMore).toBe(true);
  });

  it("says there is no more when the page came back short", () => {
    const { items, hasMore } = takePage([1, 2], 4);
    expect(items).toEqual([1, 2]);
    expect(hasMore).toBe(false);
  });

  it("does not claim a next page when the last row exactly fills this one", () => {
    // Four rows asked for as five, four came back: that is the end of the
    // list, and offering "show more" here is how somebody stops trusting it.
    const { items, hasMore } = takePage([1, 2, 3, 4], 4);
    expect(items).toEqual([1, 2, 3, 4]);
    expect(hasMore).toBe(false);
  });

  it("handles an empty list", () => {
    expect(takePage([], 4)).toEqual({ items: [], hasMore: false });
  });
});

describe("fetchAllRows", () => {
  /** A fake table, handed out in pages the way PostgREST does. */
  const table = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: String(i) }));

  const pager = (rows: { id: string }[], calls: number[][] = []) =>
    async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    };

  it("gets past the cap that silently truncates", async () => {
    // The bug this exists for: 1,797 contacts, a thousand come back, and
    // nothing says the rest are missing.
    const rows = await fetchAllRows(pager(table(1797)), 1000);
    expect(rows).toHaveLength(1797);
  });

  it("asks for exactly the pages it needs and no more", async () => {
    const calls: number[][] = [];
    await fetchAllRows(pager(table(1797), calls), 1000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("stops on the first short page rather than counting first", async () => {
    const calls: number[][] = [];
    await fetchAllRows(pager(table(10), calls), 1000);
    expect(calls).toHaveLength(1);
  });

  it("makes one request for an empty table", async () => {
    const calls: number[][] = [];
    expect(await fetchAllRows(pager(table(0), calls), 1000)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("asks a second time when the first page is exactly full", async () => {
    // Otherwise a table of exactly a thousand and one loses its last row.
    const calls: number[][] = [];
    const rows = await fetchAllRows(pager(table(1000), calls), 1000);
    expect(rows).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("throws rather than returning half a book", async () => {
    // A partial answer that looks whole is the failure being fixed here.
    await expect(
      fetchAllRows(async () => ({ data: null, error: new Error("boom") }))
    ).rejects.toThrow("boom");
  });

  it("gives up rather than looping forever on a server that ignores the range", async () => {
    let calls = 0;
    const rows = await fetchAllRows(async () => {
      calls += 1;
      return { data: table(1000), error: null };
    }, 1000);
    expect(rows.length).toBeGreaterThan(200_000);
    expect(calls).toBeLessThan(1000);
  });
});
