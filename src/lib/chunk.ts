/**
 * Cutting a list into pieces small enough to send as one statement.
 *
 * A file import wants to be one write rather than a thousand, but the other
 * extreme is its own problem: a single statement carrying every row of a big
 * export is a request body that can exceed what the API will take, a
 * transaction that holds locks for as long as the whole file takes, and an
 * all-or-nothing failure with no way to say how far it got. A few hundred rows
 * at a time is the size where the round trips stop being the cost and none of
 * that has started.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  // A size of zero would spin forever rather than fail, and a caller that
  // computed one by accident deserves the harmless answer, not the hang.
  const step = Math.max(1, Math.floor(size));
  const pieces: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    pieces.push(items.slice(start, start + step));
  }
  return pieces;
}
