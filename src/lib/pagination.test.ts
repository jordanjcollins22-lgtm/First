import { describe, expect, it } from "vitest";

import { boundedPageSize, takePage } from "./pagination";

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
