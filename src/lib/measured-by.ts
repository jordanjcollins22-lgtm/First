/**
 * How an area's size was taken, asked on the walkthrough with the size.
 *
 * A size read off a map is a guess at where the lawn stops and the woods
 * begin, and it is priced like any other. One once put 34,730 sq ft on a back
 * lawn of about 14,000, and the job came out four times too long. Saying so
 * is what lets the price check it against the aerial before it goes out.
 */
export const MEASURED_ON_SITE = "Measured on site";
export const MEASURED_FROM_MAP = "Estimated from the map";
export const MEASURED_BY = [MEASURED_ON_SITE, MEASURED_FROM_MAP] as const;

/** Where the answer is kept, among the area's walkthrough answers. */
export const MEASURED_BY_KEY = "measuredBy";
