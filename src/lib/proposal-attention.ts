/**
 * What a client actually read, and what they pressed.
 *
 * The office already knows whether a proposal was opened and how often. What
 * it has never known is what happened inside the open, and that is where the
 * useful part is. Somebody who spent ninety seconds on the price and four on
 * the scope has a different objection from somebody who read the fence area
 * three times and never scrolled to the total, and the phone call that
 * follows should not be the same call.
 *
 * Two measurements, kept apart because they mean different things.
 *
 * Dwell is how long a section was actually on screen. It is the honest
 * version of "what were they looking at", and it has to be measured rather
 * than inferred from scroll position: a page scrolled past in one flick has
 * technically shown every section and told you nothing.
 *
 * A click is a decision. Fewer of them, worth more each. "Ask about this" on
 * one area is the single most informative thing a client can do short of
 * replying, because they have told you which part of the job they are unsure
 * about without having to write anything.
 *
 * What is deliberately not here: anything identifying. A visit carries the
 * same salted, per proposal hash the view log already uses, so two people in
 * one household can be told apart on one proposal and the same person cannot
 * be followed between two. There is no cursor tracking, no scroll recording
 * and no session replay. The question being answered is "which part of this
 * quote are they stuck on", and none of that is needed to answer it.
 */

/** Sections of the proposal, in the order they appear on the page. */
export const SECTIONS = [
  "property-map",
  "scope",
  "price",
  "settling-in",
  "terms",
  "questions",
  "message",
] as const;

export type SectionKey = (typeof SECTIONS)[number] | string;

export const SECTION_LABEL: Record<string, string> = {
  "property-map": "The map of their property",
  scope: "Scope of work",
  price: "The price",
  "settling-in": "What it will look like, and when",
  terms: "The terms",
  questions: "Common questions",
  message: "The message box",
};

/**
 * Below this, a section was scrolled past rather than read.
 *
 * A page flicked through top to bottom puts every section on screen for a
 * moment. Counting those as attention makes the ranking meaningless, because
 * everything scores and nothing stands out.
 */
export const GLANCE_SECONDS = 2;

export type EventKind = "section" | "click";

export interface AttentionEvent {
  kind: EventKind;
  /** A stable key. For a zone, the zone's own name. */
  target: string;
  /** What to call it on screen, when the key is not readable. */
  label: string | null;
  /** Seconds on screen. Only on a section. */
  seconds: number;
  at: string;
  visitorHash: string | null;
}

export interface AttentionLine {
  target: string;
  label: string;
  /** Total across every visit. */
  seconds: number;
  /** How many separate times it came on screen. */
  times: number;
  /** Share of all the time spent reading. */
  share: number;
}

export interface ClickLine {
  target: string;
  label: string;
  count: number;
  lastAt: string;
}

export interface AttentionSummary {
  /** Sections by how long they were read, longest first. */
  read: AttentionLine[];
  /** What was pressed, most first. */
  clicks: ClickLine[];
  /** Everything read, in seconds. */
  totalSeconds: number;
  /** What they spent longest on. The one line worth putting on a card. */
  focus: AttentionLine | null;
  /** Whether there is enough here to say anything at all. */
  thin: boolean;
}

const EMPTY: AttentionSummary = {
  read: [],
  clicks: [],
  totalSeconds: 0,
  focus: null,
  thin: true,
};

/**
 * Below this much reading in total, the shape of it is noise.
 *
 * Somebody who opened the page for eight seconds has a most-read section, and
 * saying so out loud would be inventing a finding out of a bounce.
 */
export const THIN_SECONDS = 15;

/**
 * What they read and what they pressed, ranked.
 *
 * Glances are dropped before ranking rather than after, so a section that was
 * only ever scrolled past does not appear at all. It appearing at the bottom
 * of the list reads as "they looked at this briefly", which is a stronger
 * claim than the measurement supports.
 */
export function summariseAttention(events: readonly AttentionEvent[]): AttentionSummary {
  if (events.length === 0) return EMPTY;

  const read = new Map<string, AttentionLine>();
  const clicks = new Map<string, ClickLine>();

  for (const event of events) {
    if (event.kind === "section") {
      if (event.seconds < GLANCE_SECONDS) continue;
      const found = read.get(event.target);
      if (found) {
        found.seconds = round(found.seconds + event.seconds);
        found.times += 1;
      } else {
        read.set(event.target, {
          target: event.target,
          label: labelFor(event.target, event.label),
          seconds: round(event.seconds),
          times: 1,
          share: 0,
        });
      }
      continue;
    }

    const found = clicks.get(event.target);
    if (found) {
      found.count += 1;
      if (event.at > found.lastAt) found.lastAt = event.at;
    } else {
      clicks.set(event.target, {
        target: event.target,
        label: labelFor(event.target, event.label),
        count: 1,
        lastAt: event.at,
      });
    }
  }

  const lines = Array.from(read.values()).sort((a, b) => b.seconds - a.seconds);
  const totalSeconds = round(lines.reduce((sum, line) => sum + line.seconds, 0));
  for (const line of lines) {
    line.share = totalSeconds > 0 ? Math.round((line.seconds / totalSeconds) * 100) / 100 : 0;
  }

  return {
    read: lines,
    clicks: Array.from(clicks.values()).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)),
    totalSeconds,
    focus: lines[0] ?? null,
    thin: totalSeconds < THIN_SECONDS,
  };
}

/**
 * One sitting: when it started, how long it ran, and what happened in it.
 *
 * Opens are already logged as sittings elsewhere, so this groups the events
 * the same way rather than inventing a second definition of a visit. Two
 * definitions of "a visit" in one product is how two screens end up
 * disagreeing about how many times a client read their quote.
 */
export interface Sitting {
  startedAt: string;
  endedAt: string;
  seconds: number;
  clicks: number;
  /** What they spent longest on in this one sitting. */
  focus: string | null;
  visitorHash: string | null;
}

/** Anything further apart than this is a new sitting. Matches the view log. */
export const SITTING_GAP_MINUTES = 30;

export function sittingsFrom(events: readonly AttentionEvent[]): Sitting[] {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const sittings: Sitting[] = [];
  let current: { events: AttentionEvent[]; hash: string | null } | null = null;

  const close = () => {
    if (!current || current.events.length === 0) return;
    const list = current.events;
    const summary = summariseAttention(list);
    sittings.push({
      startedAt: list[0].at,
      endedAt: list[list.length - 1].at,
      seconds: summary.totalSeconds,
      clicks: list.filter((event) => event.kind === "click").length,
      focus: summary.focus?.label ?? null,
      visitorHash: current.hash,
    });
    current = null;
  };

  for (const event of ordered) {
    const last = current?.events[current.events.length - 1];
    const apart = last
      ? (Date.parse(event.at) - Date.parse(last.at)) / 60_000
      : Number.POSITIVE_INFINITY;
    // A different person on the same proposal is a different sitting however
    // close together the two are.
    if (!current || apart > SITTING_GAP_MINUTES || current.hash !== event.visitorHash) {
      close();
      current = { events: [event], hash: event.visitorHash };
      continue;
    }
    current.events.push(event);
  }
  close();

  return sittings.reverse();
}

/**
 * The one sentence an account manager reads.
 *
 * Says what they spent the most time on, because that is what to open the
 * call with. Silent when there is not enough to say, rather than reaching for
 * the biggest number in a thin set of measurements.
 */
export function attentionLabel(summary: AttentionSummary): string {
  if (summary.read.length === 0 && summary.clicks.length === 0) return "Nothing read yet";
  if (summary.thin) return "Opened, but barely read";
  if (!summary.focus) return "Read, with no one section standing out";
  return `Most time on ${summary.focus.label.toLowerCase()} (${describeSeconds(summary.focus.seconds)})`;
}

/** Seconds, said the way a person would say them. */
export function describeSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 10 && rest > 0) return `${minutes}m ${rest}s`;
  return `${minutes}m`;
}

function labelFor(target: string, given: string | null): string {
  return given?.trim() || SECTION_LABEL[target] || target;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
