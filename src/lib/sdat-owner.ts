/**
 * The owner's name, from the State's own record of the property.
 *
 * The open-data roll leaves the owner's name out on purpose, so the name
 * comes from the State's property-record page for the account, the same
 * page the card links to. Read once when somebody first clicks the house,
 * kept beside the house after that. Pure: the page's text in, the facts
 * out, so it can be tested without the State.
 */

export interface SdatOwner {
  ownerName: string | null;
  mailing: string | null;
  /** YES or NO on the record, when the page says. */
  principalResidence: boolean | null;
}

/** The page as lines of plain text, tags gone, in reading order. */
export function pageLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th|tr|div|p|li|span|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/** "Use:", "Principal Residence: YES": a label, with or without its value on the same line. */
const LABEL = /^[A-Za-z][A-Za-z /()'-]{1,40}:(\s|$)/;

/** The values after a label, up to the next label. Handles "Label: value" on one line too. */
function valuesAfter(lines: string[], label: RegExp): string[] {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    const inline = lines[i].slice(m[0].length).trim();
    const out: string[] = inline ? [inline] : [];
    for (let j = i + 1; j < lines.length && out.length < 6; j++) {
      if (LABEL.test(lines[j])) break;
      out.push(lines[j]);
    }
    if (out.length > 0) return out;
  }
  return [];
}

export function parseSdatOwner(html: string): SdatOwner | null {
  const lines = pageLines(html);
  if (lines.length === 0) return null;
  const names = valuesAfter(lines, /^Owner Name:/i).filter((v) => !/^(n\/a|none)$/i.test(v));
  const mailing = valuesAfter(lines, /^Mailing Address:/i);
  const principal = valuesAfter(lines, /^Principal Residence:/i)[0] ?? null;
  if (names.length === 0 && mailing.length === 0 && principal === null) return null;
  return {
    ownerName: names.length > 0 ? names.join(" & ") : null,
    mailing: mailing.length > 0 ? mailing.join(", ") : null,
    principalResidence: principal === null ? null : /^yes/i.test(principal) ? true : /^no/i.test(principal) ? false : null,
  };
}
