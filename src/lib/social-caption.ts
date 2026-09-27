/**
 * The caption on a before-and-after post, in four parts.
 *
 * Hook: the first line, the one that stops somebody scrolling. Meat: what
 * was done, in plain words, and why it looks better. CTA: book the free
 * evaluation, with how. SEO: the service and the area said the way somebody
 * searches for them, then a handful of hashtags.
 *
 * Never anything that says whose house it was. The area is the town and the
 * zip code and nothing narrower: no street, no house number, no name, no
 * "a client in", nothing a neighbour could use to point at the house. The
 * writer is never told those things, and what comes back is scrubbed of them
 * anyway, because a public caption is not somewhere to trust a request.
 *
 * Pure, so the rules are tested without the model.
 */

import { z } from "zod";

import { checkComment } from "@/lib/comment-prompt";

export const CaptionSchema = z.object({
  hook: z.string().describe("One line. The transformation, said so somebody stops scrolling. No question marks, no emoji."),
  meat: z.string().describe("Two to four short sentences: what was done here and why it looks better."),
  cta: z.string().describe("One or two sentences: book a free evaluation, with the link and the phone number exactly as given."),
  seo: z
    .string()
    .describe("A short line saying the service and the area the way people search for them, then 5 to 8 hashtags on the same line."),
});
export type CaptionParts = z.infer<typeof CaptionSchema>;

/** Where the work was, as a post may say it: the town, the state and the zip. */
export interface CaptionArea {
  town: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * The town, state and zip out of a full address, and nothing narrower.
 *
 * "123 Main St, Bel Air, Maryland 21014, United States" gives Bel Air, MD,
 * 21014. The street line is dropped on the way through.
 */
export function areaFromAddress(address: string | null | undefined): CaptionArea | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^united states$/i.test(p));
  if (parts.length < 2) return null;
  const stateZip = parts[parts.length - 1];
  const zip = stateZip.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const stateWord = stateZip.replace(/\d{5}(?:-\d{4})?/, "").trim();
  const state = /^maryland$/i.test(stateWord) ? "MD" : /^[A-Z]{2}$/.test(stateWord) ? stateWord : stateWord || null;
  const town = parts.length >= 3 ? parts[parts.length - 2] : null;
  if (town && /^\d/.test(town)) return { town: null, state, zip };
  return { town, state, zip };
}

export function describeArea(area: CaptionArea | null): string {
  if (!area) return "Harford County, MD";
  return [area.town, [area.state, area.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Harford County, MD";
}

export function captionSystemPrompt(businessName: string): string {
  const name = businessName.trim() || "our company";
  return [
    `You write the caption for a before-and-after photo that ${name}, a local landscaping company, posts on Facebook and Instagram.`,
    "",
    "Write it in four parts:",
    "1. Hook: one line that stops somebody scrolling. Lead with the transformation. Plain words, no clickbait, no question.",
    "2. Meat: two to four short sentences on what was done in this area and why it looks better. Use the details given: the service, the materials, the colour, the size. Nothing invented.",
    "3. CTA: book a free evaluation. Give the booking link and the phone number exactly as given.",
    "4. SEO: one short line saying the service and the area the way somebody would search for it (for example: mulching and bed edging in Bel Air, MD 21014), then 5 to 8 hashtags on that same line: the service, the town, the county, and landscaping.",
    "",
    "Privacy, without exception:",
    "- The area is the town and the zip code, and nothing narrower. Never a street, a house number, a neighbourhood or development name, or anything that points at one house.",
    "- Never a person's name, never 'our client', 'the homeowner', 'Mrs', 'this family' or anything about who lives there.",
    "",
    "Claims:",
    "- Say only what the details given support. No reviews, ratings, awards, years in business, guarantees, licences or insurance.",
    "- Never say the business does tree work, stump grinding, electrical, plumbing, gas, roofing or HVAC.",
    "",
    "Style:",
    "- Friendly, local and confident. Short sentences. At most one emoji in the whole caption, or none.",
    "- No em dashes or en dashes. Use a comma or a full stop.",
  ].join("\n");
}

export function captionBrief(input: {
  service: string;
  details: string[];
  sizeLabel: string | null;
  area: CaptionArea | null;
  phone: string;
  bookingUrl: string;
}): string {
  return [
    `Service: ${input.service}`,
    input.details.length ? `Details: ${input.details.join("; ")}` : "Details: none recorded beyond the service.",
    input.sizeLabel ? `Size: ${input.sizeLabel}` : null,
    `Area: ${describeArea(input.area)}`,
    `Booking link: ${input.bookingUrl}`,
    `Phone: ${input.phone}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A street line: a house number and a street name with its suffix. */
const STREET = /\b\d{1,6}\s+(?:[A-Z][\w'.]*\s+){1,4}(?:Road|Rd|Street|St|Lane|Ln|Court|Ct|Drive|Dr|Avenue|Ave|Place|Pl|Way|Circle|Cir|Boulevard|Blvd|Terrace|Ter|Trail|Trl|Pike|Highway|Hwy)\b\.?/g;

/**
 * Take out anything that says whose house it was: the street line, the
 * client's names, the street name on its own. Words shorter than three
 * letters are left alone, so an initial cannot eat half the caption.
 */
export function scrubCaption(text: string, privateTerms: string[]): string {
  let out = text.replace(STREET, "");
  const terms = [...new Set(privateTerms.map((t) => t.trim()).filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    out = out.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
  }
  return out
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.!])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The four parts, one paragraph each. */
export function composeCaption(parts: CaptionParts): string {
  return [parts.hook, parts.meat, parts.cta, parts.seo].map((p) => p.trim()).filter(Boolean).join("\n\n");
}

/** What is wrong with a caption, in words: private details left in, or a claim we cannot make. */
export function captionProblems(text: string, privateTerms: string[]): string[] {
  const problems: string[] = [];
  if (STREET.test(text)) problems.push("It names a street.");
  STREET.lastIndex = 0;
  const lower = text.toLowerCase();
  for (const term of privateTerms.map((t) => t.trim()).filter((t) => t.length >= 3)) {
    if (new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) problems.push("It names the client or their street.");
  }
  const check = checkComment(text);
  if (!check.ok) problems.push(...check.problems);
  return [...new Set(problems)];
}

/**
 * The words that must not appear: the client's names, their street and its
 * name on its own. From the job's customer name and property address.
 */
export function privateTermsFor(customerName: string | null | undefined, address: string | null | undefined): string[] {
  const terms: string[] = [];
  for (const word of (customerName ?? "").split(/\s+/)) if (word) terms.push(word);
  const street = (address ?? "").split(",")[0]?.trim();
  if (street) {
    terms.push(street);
    // The street name without its number: "Lomond Place".
    const name = street.replace(/^\d+[a-z]?\s+/i, "");
    if (name && name !== street) terms.push(name);
  }
  return terms;
}

/**
 * The caption when the writer cannot be reached: the four parts from a
 * template, in the same shape, with nothing private in it.
 */
export function fallbackCaption(input: { service: string; area: CaptionArea | null; phone: string; bookingUrl: string }): string {
  const where = describeArea(input.area);
  const town = input.area?.town ?? "Harford County";
  const service = input.service.trim() || "Landscaping";
  const tag = (s: string) => `#${s.replace(/[^A-Za-z0-9]/g, "")}`;
  return composeCaption({
    hook: `Same yard, new look. ${service} in ${town}.`,
    meat: `Swipe to see the before. Clean lines, fresh finish, and a front that looks cared for again.`,
    cta: `Book a free evaluation in under 5 minutes: ${input.bookingUrl} or call or text ${input.phone}.`,
    seo: `${service} in ${where}. ${[tag(service), tag(town), "#HarfordCounty", "#MarylandLandscaping", "#Landscaping", "#BeforeAndAfter"].join(" ")}`,
  });
}
