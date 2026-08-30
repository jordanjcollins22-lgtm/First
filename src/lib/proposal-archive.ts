/**
 * Quotes written before this app existed.
 *
 * Years of them live in the old CRM as PDFs. Carrying them across is worth
 * doing for two reasons and the second is the bigger one: a client's record
 * should say what we have already quoted them, so nobody re-quotes a job we
 * lost on price last spring without knowing — and the ones we did not win are
 * a list of people who wanted the work, got a number, and said no.
 *
 * What matters on each one is what happened to it. A pile of PDFs with no
 * outcome on them is a filing cabinet; a pile with won, lost or disputed
 * against each is the thing the next quote is written from.
 */

export type ProposalOutcome = "won" | "lost" | "disputed";

export const OUTCOMES: {
  value: ProposalOutcome;
  label: string;
  blurb: string;
}[] = [
  { value: "won", label: "We got it", blurb: "They said yes and the work happened." },
  { value: "lost", label: "We didn't get it", blurb: "They said no, or went quiet." },
  { value: "disputed", label: "It went wrong", blurb: "Sold, but it ended in a dispute." },
];

export function isOutcome(value: string): value is ProposalOutcome {
  return OUTCOMES.some((o) => o.value === value);
}

export function outcomeLabel(value: string | null | undefined): string {
  return OUTCOMES.find((o) => o.value === value)?.label ?? "Unknown";
}

/** Twenty-five megabytes. A scanned multi-page quote is the big one, and a
 * ceiling somebody hits while archiving a year of work is a ceiling that
 * stops the archiving. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export interface FileCheck {
  ok: boolean;
  /** Everything wrong with it, not just the first thing. Somebody picking
   * files off a phone should not have to fix them one round trip at a time. */
  message: string | null;
}

export function checkArchiveFile(file: { type: string; size: number }): FileCheck {
  const faults: string[] = [];
  if (!ACCEPTED_TYPES.includes(file.type)) {
    faults.push("It needs to be a PDF, a PNG or a JPG.");
  }
  if (file.size > MAX_FILE_BYTES) {
    faults.push(`It is ${megabytes(file.size)}MB, and the limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  }
  if (file.size === 0) faults.push("That file is empty.");
  return { ok: faults.length === 0, message: faults.length > 0 ? faults.join(" ") : null };
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** The extension to store it under, from the type the browser reported. */
export function extensionFor(type: string): string {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  return "jpg";
}

export interface ArchivedProposal {
  id: string;
  filePath: string;
  fileName: string;
  outcome: string;
  jobDate: string | null;
  title: string | null;
  amount: number | null;
  notes: string | null;
}

export interface ArchiveSummary {
  total: number;
  won: number;
  lost: number;
  disputed: number;
  /** What the won ones came to, where an amount was entered. Null when none
   * of them carry one, which is different from them coming to nothing. */
  wonValueCents: number | null;
}

export function summariseArchive(rows: ArchivedProposal[]): ArchiveSummary {
  let won = 0;
  let lost = 0;
  let disputed = 0;
  let wonValue = 0;
  let anyWonAmount = false;

  for (const row of rows) {
    if (row.outcome === "won") {
      won += 1;
      if (row.amount != null) {
        wonValue += Math.round(row.amount * 100);
        anyWonAmount = true;
      }
    } else if (row.outcome === "lost") lost += 1;
    else if (row.outcome === "disputed") disputed += 1;
  }

  return { total: rows.length, won, lost, disputed, wonValueCents: anyWonAmount ? wonValue : null };
}

/** The line above the list on a client's record. */
export function archiveLine(summary: ArchiveSummary): string {
  if (summary.total === 0) return "No older quotes on file.";
  const parts: string[] = [];
  if (summary.won > 0) parts.push(`${summary.won} won`);
  if (summary.lost > 0) parts.push(`${summary.lost} lost`);
  if (summary.disputed > 0) parts.push(`${summary.disputed} that went wrong`);
  const quotes = summary.total === 1 ? "1 older quote" : `${summary.total} older quotes`;
  return parts.length > 0 ? `${quotes} — ${parts.join(", ")}.` : `${quotes}.`;
}

/** Newest job first, and anything undated last: a quote with no date on it is
 * the one somebody has not finished filling in, and it belongs where it can
 * be seen rather than buried in the middle. */
export function byJobDate(rows: ArchivedProposal[]): ArchivedProposal[] {
  return [...rows].sort((a, b) => {
    if (!a.jobDate && !b.jobDate) return 0;
    if (!a.jobDate) return 1;
    if (!b.jobDate) return -1;
    return b.jobDate.localeCompare(a.jobDate);
  });
}
