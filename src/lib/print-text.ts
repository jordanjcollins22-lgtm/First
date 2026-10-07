/**
 * Setting text on a printed page, whatever the page is about.
 *
 * These three came out of the weed sheet and are wanted again by the kit
 * checklist, so they live here rather than being copied. None of them knows
 * anything about weeds or tools: give them a way to measure a string and they
 * fit it into a width.
 */

const SUBSTITUTES: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201c": '"', "\u201d": '"',
  "\u2013": "-", "\u2014": "\u2014", "\u2026": "\u2026", "\u00a0": " ", "\u2022": "\u00b7",
  "\u2032": "'", "\u2033": '"', "\u2212": "-",
};

export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (line: string) => number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines < 1) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  // Anything that did not fit is admitted to rather than silently dropped: a
  // name that stops mid-word looks like a bug, and a name that ends in an
  // ellipsis looks like a name that was too long for the box.
  const fitted = lines.slice(0, maxLines).map((l) => truncate(l, maxWidth, measure));
  const saidEverything = words.join(" ") === fitted.join(" ");
  if (!saidEverything && fitted.length > 0) {
    const last = fitted[fitted.length - 1];
    if (!last.endsWith("…")) fitted[fitted.length - 1] = ellipsize(last, maxWidth, measure);
  }
  return fitted;
}

/** One line cut to fit, ending in an ellipsis. Left alone if it already fits. */
export function truncate(text: string, maxWidth: number, measure: (line: string) => number): string {
  return measure(text) <= maxWidth ? text : ellipsize(text, maxWidth, measure);
}

/** One line with an ellipsis on the end, shortened until the pair of them fit. */
function ellipsize(text: string, maxWidth: number, measure: (line: string) => number): string {
  let cut = text;
  while (cut.length > 0 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Text a PDF's built-in fonts can actually set.
 *
 * The standard fourteen fonts are Latin-1, and a weed name or a business name
 * typed with a curly apostrophe would otherwise fail the whole download rather
 * than one character. The characters people really type are mapped to their
 * plain equivalents; anything left over is dropped, because a missing glyph is
 * better than a missing file.
 */

export function latin1(text: string): string {
  let out = "";
  for (const character of text) {
    const swap = SUBSTITUTES[character];
    const candidate = swap ?? character;
    // A tab or a newline would be drawn as a box; a cell is one line anyway.
    if (candidate === "\n" || candidate === "\t" || candidate === "\r") {
      out += " ";
      continue;
    }
    if (candidate.codePointAt(0)! <= 0xff) out += candidate;
  }
  return out;
}

/**
 * How the browser should treat the file.
 *
 * Inline, unless somebody asked to save it. A file sent as an attachment is
 * saved and not shown, and on a phone that means it disappears into Files with
 * no viewer, no share button and no way to print -- which is the one thing the
 * PDF was made for. Sent inline it opens in the browser's own PDF viewer,
 * where print and share are right there. The name still travels with it, so
 * saving it from the viewer still lands a sensibly named file.
 */
