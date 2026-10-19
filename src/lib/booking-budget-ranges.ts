/** Shared between the public booking wizard and the server action that
 * validates the submission — keep these in sync if the brackets change. */
export const BUDGET_RANGES = [
  // A real answer, and the reason it is here: the booking used to refuse to
  // submit without a bracket, so somebody who genuinely did not know lost the
  // appointment at the last click rather than telling us they did not know.
  "Not sure yet",
  // Split at $1,500, the photo-quote line's default, so the smallest jobs
  // can be told apart from the next ones up. See photo-quote.ts.
  "Under $1,500",
  "$1,500 – $2,500",
  "$2,500 – $5,000",
  "$5,000 – $15,000",
  "$15,000 – $30,000",
  "$30,000+",
] as const;
