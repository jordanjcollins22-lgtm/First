/**
 * Page sizes, and the arithmetic that keeps a list bounded.
 *
 * A list screen that reads its whole table works beautifully for a year and
 * then stops, and it stops on the day somebody is busiest, because that is
 * the day the table grew. So every list here asks for a page and is told
 * honestly whether there is more behind it.
 *
 * The number a caller asks for comes off a query string, which means it is a
 * string somebody can type. Clamping is not defensive tidiness: without it
 * "?show=999999" is a way for anybody with the URL to ask the database for
 * the whole table, which is the thing the page size exists to prevent.
 */

/**
 * A page size that can be trusted, from whatever the caller had.
 *
 * Anything that is not a positive whole number falls back rather than
 * throwing: a mistyped URL should show the first page, not an error page.
 */
export function boundedPageSize(
  requested: string | number | null | undefined,
  fallback: number,
  max: number
): number {
  const asNumber = typeof requested === "string" ? Number(requested.trim()) : requested;
  if (asNumber === null || asNumber === undefined) return fallback;
  if (!Number.isFinite(asNumber)) return fallback;
  const whole = Math.floor(asNumber);
  if (whole < 1) return fallback;
  return Math.min(whole, max);
}

/**
 * One page out of the rows that came back, and whether more were waiting.
 *
 * The caller is expected to have asked the database for one row more than it
 * means to show. That extra row is the whole trick: it answers "is there a
 * next page" without a second query and without a count, both of which cost
 * more than the page itself on a table worth paginating.
 */
export function takePage<T>(rows: T[], pageSize: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
