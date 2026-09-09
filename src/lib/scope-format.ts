/**
 * Laying out a scope of work that is already written.
 *
 * The wording is somebody's, and it is right. What was wrong was the shape of
 * it: a heading, twelve bullets and a second heading all run together into one
 * six-hundred-word paragraph, because that is what a textarea holds and what a
 * <p> renders. A client reading it cannot find the end of one thing and the
 * start of the next, which is the only job the layout has.
 *
 * So this reorganises and nothing else. Every rule here moves text or hides a
 * bullet character; not one of them writes a word, drops a word, or decides
 * that a sentence was not worth keeping. That is also checked rather than
 * asserted: `sameContent` compares what went in against what came out, and it
 * is what stands between a tidied scope and a quietly edited one.
 */

/** A heading, and the things under it. Either can be missing. */
export interface ScopeSection {
  /** The line above the bullets, when the wording has one. */
  heading: string | null;
  items: string[];
}

/** How a bullet is written in stored scope text. */
const BULLET = "•";

/**
 * Whether a fragment reads as a heading rather than as a sentence.
 *
 * A heading is a short label with no full stop: "Initial Lawn Repair",
 * "Recurring Lawn Maintenance". A sentence ends in punctuation and is longer.
 * Getting this wrong in the cautious direction costs a bullet that should have
 * been a heading, which is untidy; getting it wrong the other way would hide a
 * sentence under a heading, which loses meaning. So it is deliberately strict.
 */
export function looksLikeHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[.!?;:]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  return words.length > 0 && words.length <= 6 && trimmed.length <= 60;
}

/**
 * The scope broken into its sections.
 *
 * Three shapes arrive here and all three come out the same way: text already
 * laid out in lines, text with bullet characters run into a paragraph, and a
 * plain paragraph of sentences. The last of those is left as one unheaded
 * section of sentences, because splitting a written paragraph into bullets
 * would be a rewrite and this does not rewrite.
 */
export function parseScope(text: string): ScopeSection[] {
  const source = (text ?? "").trim();
  if (!source) return [];

  const sections: ScopeSection[] = [];
  let current: ScopeSection | null = null;

  const startSection = (heading: string | null) => {
    current = { heading, items: [] };
    sections.push(current);
  };
  const addItem = (item: string) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    if (!current) startSection(null);
    current!.items.push(trimmed);
  };

  // Already laid out: one thing per line, headings as bare lines.
  const lines = source.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) {
      const bulleted = line.startsWith(BULLET) || /^[-*]\s/.test(line);
      const body = line.replace(/^[•\-*]\s*/, "").trim();
      if (!bulleted && looksLikeHeading(body)) startSection(body);
      else addItem(body);
    }
    return sections.filter((section) => section.heading || section.items.length > 0);
  }

  // One paragraph. With bullets in it, the bullets are the structure.
  if (source.includes(BULLET)) {
    const chunks = source.split(BULLET).map((chunk) => chunk.trim());
    const opening = chunks.shift() ?? "";
    if (opening) {
      if (looksLikeHeading(opening)) startSection(opening);
      else addItem(opening);
    }
    for (const chunk of chunks) {
      // A heading for the next run often sits at the tail of a bullet, after
      // the sentence that ended it: "...as reasonably possible. Recurring Lawn
      // Maintenance". Whatever follows the last full stop, if it reads as a
      // heading, is one.
      const lastStop = Math.max(chunk.lastIndexOf("."), chunk.lastIndexOf("!"), chunk.lastIndexOf("?"));
      const tail = lastStop >= 0 ? chunk.slice(lastStop + 1).trim() : "";
      if (tail && looksLikeHeading(tail)) {
        addItem(chunk.slice(0, lastStop + 1));
        startSection(tail);
      } else {
        addItem(chunk);
      }
    }
    return sections.filter((section) => section.heading || section.items.length > 0);
  }

  // A plain paragraph. One section, one item: it was written as prose and it
  // stays prose.
  return [{ heading: null, items: [source] }];
}

/**
 * The sections written back out as text.
 *
 * Headings on their own line, everything else bulleted under them, which is
 * both what a person types and what `parseScope` reads back. The stored scope
 * is still plain text, so nothing downstream has to learn a format.
 */
export function renderScope(sections: readonly ScopeSection[]): string {
  const blocks = sections.map((section) => {
    // A lone sentence with nothing above it is a paragraph, and a bullet in
    // front of a paragraph is a list of one. Bullets are for a list.
    const listed = Boolean(section.heading) || section.items.length > 1;
    const body = section.items.map((item) => (listed ? `${BULLET} ${item}` : item)).join("\n");
    if (!section.heading) return body;
    return body ? `${section.heading}\n${body}` : section.heading;
  });
  return blocks.filter(Boolean).join("\n\n");
}

/** The scope laid out, with not one word changed. */
export function tidyScope(text: string): string {
  return renderScope(parseScope(text));
}

/**
 * Every piece of wording in a scope, in no particular order.
 *
 * Headings count as pieces. This is what "nothing was added or removed" is
 * measured against, so anything a reader would notice missing has to be in
 * here.
 */
export function scopeContent(text: string): string[] {
  return parseScope(text).flatMap((section) => [
    ...(section.heading ? [section.heading] : []),
    ...section.items,
  ]);
}

/**
 * One piece of wording, reduced to what it says.
 *
 * Case, punctuation and spacing are layout, not content: moving a sentence
 * under a heading may capitalise it or take a trailing comma off it, and that
 * is not a change worth refusing a tidier layout over. A missing clause is.
 */
export function normaliseItem(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"]+/g, " ")
    .trim();
}

/**
 * Whether two versions of a scope say the same things.
 *
 * A multiset, not a set: a scope that says the same line twice and comes back
 * saying it once has lost something, even though every distinct line survived.
 * Order is deliberately not compared, because reordering is the point.
 */
export function sameContent(before: string, after: string): boolean {
  const count = (text: string) => {
    const counts = new Map<string, number>();
    for (const item of scopeContent(text)) {
      const key = normaliseItem(item);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const a = count(before);
  const b = count(after);
  if (a.size !== b.size) return false;
  for (const [key, n] of a) if (b.get(key) !== n) return false;
  return true;
}
