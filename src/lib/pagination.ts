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

/**
 * Every row, in pages, when every row is genuinely what is wanted.
 *
 * PostgREST caps a request that asks for no range, and the cap is silent — a
 * thousand rows come back and nothing anywhere says the other eight hundred
 * exist. That is the worst shape a limit can have: the page renders, the
 * numbers look plausible, and the contact whose name starts with a W is
 * simply not in the book.
 *
 * So a read that means "all of them" has to say so in pages. This is not a
 * licence to read whole tables — a list screen should use `boundedPageSize`
 * and show one page. It is for the reads that genuinely need the lot:
 * matching an import against the whole book, or scanning for duplicates,
 * where working from a truncated list gives a wrong answer rather than a
 * short one.
 *
 * Stops on the first short page, which is how it knows it has reached the
 * end without a count.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;

    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;

    // A guard against a page that never shortens. Without it a server that
    // ignores the range would loop until the process died, which is a worse
    // failure than the truncation this exists to fix.
    if (all.length > 200_000) break;
  }

  return all;
}
