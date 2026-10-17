/**
 * The words the fix-it bot says in Discord. Pure, so they're tested without
 * Discord: a message over Discord's 2,000-character limit is refused
 * outright, so anything long is split on line breaks before it's sent.
 */

export const DISCORD_LIMIT = 2000;

export type TicketStatus = "open" | "building" | "fixed" | "question" | "sent_back" | "closed";
export type BuildStatus = "queued" | "running" | "ready" | "approved" | "failed";

export interface TicketLine {
  number: number;
  description: string;
  status: TicketStatus;
  result?: string | null;
}

export interface BuildForMessage {
  number: number;
  status: BuildStatus;
  summary: string | null;
  previewUrl: string | null;
  branch?: string | null;
}

export const STATUS_WORD: Record<TicketStatus, string> = {
  open: "open",
  building: "building",
  fixed: "fixed",
  question: "question",
  sent_back: "sent back",
  closed: "closed",
};

/** The first line of a description, cut to fit one line of a list. */
export function firstLine(text: string, max = 100): string {
  const line = (text ?? "").trim().split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Splits text into pieces of at most `limit` characters, breaking at a line
 * break where it can, then at a space, and only mid-word as a last resort.
 */
export function splitMessage(text: string, limit = DISCORD_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n");
    if (cut < limit / 2) cut = window.lastIndexOf(" ");
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export function ticketSavedMessage(number: number): string {
  return `Ticket #${number} saved.`;
}

/** /sum: every ticket not closed yet, oldest first. */
export function ticketListMessage(tickets: TicketLine[]): string {
  if (!tickets.length) return "No open tickets.";
  const lines = tickets.map((t) => `#${t.number} — ${firstLine(t.description)} (${STATUS_WORD[t.status]})`);
  return [`${tickets.length} open ticket${tickets.length === 1 ? "" : "s"}:`, ...lines].join("\n");
}

export function buildQueuedMessage(buildNumber: number, ticketCount: number): string {
  return `Build #${buildNumber} queued: ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}. I'll post the summary and preview here when it's ready.`;
}

/** One ticket's line under a build's summary: "#4 — fixed: moved the button". */
export function resultLine(t: TicketLine): string {
  const word = t.status === "fixed" || t.status === "closed" ? "fixed" : t.status === "question" ? "question" : STATUS_WORD[t.status];
  const result = (t.result ?? "").trim().replace(/\s*\n\s*/g, " ");
  return `#${t.number} — ${word}${result ? `: ${result.length > 300 ? `${result.slice(0, 299)}…` : result}` : ""}`;
}

/**
 * What goes to the channel when a build is ready (or failed): the summary,
 * the preview link, a line per ticket and what to do next, split into as
 * many messages as it takes.
 */
export function buildReadyMessages(build: BuildForMessage, tickets: TicketLine[]): string[] {
  const parts: string[] = [];
  if (build.status === "failed") {
    parts.push(`Build #${build.number} failed.`);
    if (build.summary?.trim()) parts.push(build.summary.trim());
    if (tickets.length) parts.push(tickets.map(resultLine).join("\n"));
    parts.push("Nothing went live. Fix or add tickets with /fixit and /sendback, then /build again.");
  } else {
    parts.push(`Build #${build.number} is ready.`);
    if (build.summary?.trim()) parts.push(build.summary.trim());
    if (build.previewUrl) parts.push(`Preview: ${build.previewUrl}`);
    if (tickets.length) parts.push(tickets.map(resultLine).join("\n"));
    parts.push("Reply /approve to put it live, or /sendback number note to redo one.");
  }
  return splitMessage(parts.join("\n\n"));
}
