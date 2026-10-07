/**
 * A free first look at a post, for when no model is on hand to sort it.
 *
 * Somebody asking for yard work nearly always names the work and asks for
 * someone in plain words: "anyone know a good lawn guy", "looking for leaf
 * cleanup". Checked against the 790 posts the model had sorted by October
 * 2026, a post with one of each and none of a business's own selling
 * phrases was a real request roughly seven times in ten, and the rule
 * caught roughly five requests in six.
 *
 * So this only ever puts a post on the board early, marked as flagged by
 * words, for a person or a later sort to confirm. It never takes one off:
 * a post it does not match is left unsorted, not called "other".
 *
 * Pure, so the rule is tested.
 */

/**
 * The work, as whole words with only their own endings: "bush" and "bushes"
 * but never "bushings" (car parts), "trim" and "trimming" but never
 * "trimester". A few are stems, where every ending is the work itself.
 */
const WORK: readonly { word: string; pattern: RegExp }[] = [
  ["lawn", "lawns?"], ["mow", "mow(?:s|ing|ed|er|ers)?"], ["landscaping", "landscap\\w*"], ["mulch", "mulch(?:es|ing|ed)?"],
  ["leaves", "leaf|leaves"], ["cleanup", "clean ?ups?"], ["yard", "yards?"], ["hedge", "hedges?"], ["shrub", "shrubs?"],
  ["bush", "bush(?:es)?"], ["grass", "grass"], ["weeds", "weeds?|weeding"], ["aeration", "aerat\\w*"], ["overseeding", "overseed\\w*"],
  ["sod", "sod"], ["trim", "trim(?:s|ming|med)?"], ["edging", "edging"], ["snow", "snow"], ["plow", "plow(?:s|ing|ed)?"],
  ["gutters", "gutters?"], ["brush", "brush"], ["overgrown", "overgrown"], ["flower bed", "flower ?beds?"],
  ["garden", "garden(?:s|ing)?"], ["tree", "trees?"], ["stump", "stumps?"],
].map(([word, source]) => ({ word, pattern: new RegExp(`(?:^| )(?:${source})(?= |$)`) }));

const ASKING = [
  "recommend", "anyone know", "any one know", "anybody know", "does anyone", "can anyone",
  "looking for", "need a", "need someone", "need somebody", "need help", "who do you use",
  "who does", "in need of", "suggestions", "referral", "quote for", "quotes for", "estimate for",
  "hiring someone",
] as const;

/** Phrases a business writes about itself, and somebody asking for help never does. */
const SELLING = [
  "licensed", "insured", "free estimate", "free quote", "book now", "dm for", "dm me for", "pm for",
  "call or text", "now booking", "taking on new", "accepting new", "spots available", "openings",
  "family owned", "no job too small", "we offer", "our services", "discount", "special offer",
  "check out our", "visit our", "serving", "call us", "message us", "limited spots",
  "years of experience", "satisfaction",
] as const;

/** Lower case, punctuation to spaces, one space between words, padded so a word's edges can be matched. */
function fold(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Phrases from the start of a word, so "episode" never counts as "sod". */
function found(haystack: string, words: readonly string[]): string[] {
  return words.filter((word) => haystack.includes(` ${fold(word).trim()}`));
}

/** The work the post names, each as a whole word. */
function workIn(haystack: string): string[] {
  return WORK.filter((w) => w.pattern.test(haystack)).map((w) => w.word);
}

export interface WordsVerdict {
  /** Names the work, asks for someone, and isn't selling. */
  request: boolean;
  /** The words that decided it, for the board to show. */
  matched: string[];
}

export function requestByWords(text: string): WordsVerdict {
  const haystack = fold(text);
  const selling = found(haystack, SELLING);
  if (selling.length > 0) return { request: false, matched: selling };
  const work = workIn(haystack);
  const asking = found(haystack, ASKING);
  if (work.length === 0 || asking.length === 0) return { request: false, matched: [] };
  return { request: true, matched: [...asking.slice(0, 2), ...work.slice(0, 2)] };
}

/** What the board shows as the reason, so nobody mistakes it for a checked sort. */
export function wordsReason(matched: readonly string[]): string {
  return `Flagged by words, not checked yet: ${matched.join(", ")}`.slice(0, 160);
}
