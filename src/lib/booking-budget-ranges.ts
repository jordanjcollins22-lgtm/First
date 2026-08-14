/** Shared between the public booking wizard and the server action that
 * validates the submission — keep these in sync if the brackets change. */
export const BUDGET_RANGES = [
  "Under $2,500",
  "$2,500 – $5,000",
  "$5,000 – $15,000",
  "$15,000 – $30,000",
  "$30,000+",
] as const;
