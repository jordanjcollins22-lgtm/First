import { objectionById } from "@/lib/objections";

/**
 * The account manager's call list.
 *
 * Every proposal that went out and has not turned into a job is money
 * sitting on somebody's kitchen table. Until now those lived on the
 * proposals page as rows with a status, and the person whose job it was to
 * ring them had to work out for themselves who to call first, what the
 * client had already said, and what to offer. This turns them into a list
 * in the order they are worth calling, with what to say on each one and one
 * tap to record what came back.
 *
 * Two kinds of proposal are on it: sent and not answered, and answered no.
 * A no is not the end of a conversation, it is a reason; a "too expensive"
 * that was never followed by "we could trim it" is a sale that was left on
 * the table by nobody in particular.
 *
 * Pure. The loader gathers, the action writes, this decides.
 */

export type CallOutcome =
  | "no_answer"
  | "call_back"
  | "thinking"
  | "too_expensive"
  | "wants_changes"
  | "next_season"
  | "went_elsewhere"
  | "said_yes"
  | "do_not_call";

export const OUTCOMES: { key: CallOutcome; label: string; hint: string; needsDate?: boolean }[] = [
  { key: "no_answer", label: "No answer", hint: "Left a message or rang out. Comes back on the list in two days." },
  { key: "call_back", label: "Call back on…", hint: "They asked for a day. Pick it.", needsDate: true },
  { key: "thinking", label: "Still deciding", hint: "Talking it over, waiting on money, comparing." },
  { key: "too_expensive", label: "Too expensive", hint: "The number is the problem." },
  { key: "wants_changes", label: "Wants changes", hint: "More, less, or different work than the proposal." },
  { key: "next_season", label: "Not now, maybe later", hint: "Comes back on the list when you say.", needsDate: true },
  { key: "went_elsewhere", label: "Went with someone else", hint: "Marks the job declined. Ask who and why." },
  { key: "said_yes", label: "Said yes", hint: "Send them back to their link to accept and pick a day." },
  { key: "do_not_call", label: "Asked us not to call", hint: "Marks the job declined and the client do-not-contact." },
];

export const OUTCOME_LABEL: Record<CallOutcome, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])) as Record<
  CallOutcome,
  string
>;

export function isCallOutcome(value: string): value is CallOutcome {
  return OUTCOMES.some((o) => o.key === value);
}

/** Outcomes that take the proposal off the list for good. */
export function closesTheCall(outcome: CallOutcome): boolean {
  return outcome === "went_elsewhere" || outcome === "do_not_call";
}

/** Days until a "no answer" is worth another try. */
export const RETRY_DAYS = 2;

/** How long a declined proposal stays worth a call before it is history. */
export const DECLINED_WINDOW_DAYS = 45;

export interface PreviousCall {
  at: string;
  outcome: CallOutcome;
  note: string | null;
  byName: string | null;
  callbackOn: string | null;
}

export interface CallItem {
  proposalId: string;
  jobId: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  address: string;
  status: "sent" | "declined";
  totalCents: number | null;
  sentAt: string | null;
  respondedAt: string | null;
  /** What they wrote when they declined, if anything. */
  responseNote: string | null;
  /** How many times the proposal has been opened, and when last. */
  opens: number;
  lastOpenAt: string | null;
  /** The section they spent longest on, when known. */
  focus: string | null;
  /** Questions they tapped on the proposal page, by id. */
  objectionIds: string[];
  /** The services on the proposal, for the script. */
  services: string[];
  accountManagerId: string | null;
  calls: PreviousCall[];
}

export interface Recommendation {
  /** What to do. */
  title: string;
  /** What to say, in the account manager's voice. */
  say: string | null;
  /** A screen to open, when one helps. */
  action: { label: string; href: string } | null;
}

export interface RankedCall extends CallItem {
  /** Why it is where it is on the list. */
  reason: string;
  /** Bigger comes first. */
  score: number;
  /** "Call now", "Call back", or "Later". */
  lane: "now" | "later";
  /** When it comes back, when it is in the later lane. */
  dueOn: string | null;
  daysSinceSent: number | null;
  recommendations: Recommendation[];
  lastCall: PreviousCall | null;
}

export interface CallList {
  now: RankedCall[];
  later: RankedCall[];
  /** Money on the table across both lanes, in cents. */
  openCents: number;
}

const DAY = 86_400_000;

function daysBetween(from: string | null, to: Date): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return null;
  return Math.floor((to.getTime() - start) / DAY);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): string {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return dayKey(next);
}

function money(cents: number | null): string {
  if (cents == null) return "the quote";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** Whether the words read as a price problem. */
export function soundsLikePrice(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(price|pricing|expensive|cost|costs|afford|budget|more than|too much|cheaper|money|steep|pricey|out of (my|our) range)\b/i.test(text);
}

/** Whether the words read as somebody else won it. */
export function soundsLikeSomeoneElse(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(went with|another (company|landscaper|quote)|someone else|other (company|quote|guy)|hired|already (done|booked))\b/i.test(text);
}

/**
 * When this one comes back on the list, if it is not due now.
 *
 * A callback date is a promise, so it wins. No answer comes back in two
 * days. Anything else is due the moment it is on the list.
 */
export function dueOn(item: CallItem): string | null {
  const last = item.calls[0] ?? null;
  if (!last) return null;
  if (last.callbackOn) return last.callbackOn;
  if (last.outcome === "no_answer") {
    const at = new Date(last.at);
    return Number.isNaN(at.getTime()) ? null : addDays(at, RETRY_DAYS);
  }
  return null;
}

/**
 * Bigger first. The order is money, then how warm they are, then how long
 * it has sat. A $22,000 proposal opened yesterday outranks a $900 one from
 * three weeks ago, and both outrank a decline nobody has rung about yet
 * only if the decline is older.
 */
export function scoreCall(item: CallItem, today: Date): { score: number; reason: string } {
  const value = (item.totalCents ?? 0) / 100;
  let score = Math.log10(Math.max(100, value)) * 20;
  const reasons: string[] = [];

  const sinceSent = daysBetween(item.sentAt, today);
  const sinceOpen = daysBetween(item.lastOpenAt, today);

  if (item.status === "sent") {
    score += 30;
    if (sinceSent != null && sinceSent >= 2) {
      score += Math.min(20, sinceSent * 2);
      reasons.push(`sent ${sinceSent} days ago with no answer`);
    } else {
      reasons.push("sent, no answer yet");
    }
    if (item.opens > 0 && sinceOpen != null && sinceOpen <= 2) {
      score += 15;
      reasons.push(sinceOpen === 0 ? "opened it today" : `opened it ${sinceOpen} day${sinceOpen === 1 ? "" : "s"} ago`);
    } else if (item.opens === 0) {
      reasons.push("never opened it");
    }
  } else {
    const sinceNo = daysBetween(item.respondedAt, today);
    score += 10;
    if (item.calls.length === 0) {
      score += 15;
      reasons.push(sinceNo != null ? `said no ${sinceNo} day${sinceNo === 1 ? "" : "s"} ago, nobody has rung` : "said no, nobody has rung");
    } else {
      reasons.push("said no");
    }
    if (soundsLikePrice(item.responseNote)) {
      score += 10;
      reasons.push("it was the price");
    }
  }

  if (item.objectionIds.length > 0) {
    score += 5;
    reasons.push(`asked ${item.objectionIds.length} question${item.objectionIds.length === 1 ? "" : "s"} on the page`);
  }
  if (!item.phone) {
    score -= 10;
    reasons.push("no phone on file");
  }

  return { score, reason: reasons.join(", ") };
}

/**
 * What to say and offer on this call.
 *
 * Drawn from what the client has already told us: the note they left, the
 * questions they tapped, how much they read, what came back last time. At
 * most three, best first, because a list of eight things to say is a list
 * of none.
 */
export function recommend(item: CallItem): Recommendation[] {
  const out: Recommendation[] = [];
  const first = item.customerName.split(" ")[0] || "there";
  const total = money(item.totalCents);
  const last = item.calls[0] ?? null;
  const trimHref = `/jobs/${item.jobId}?view=scope`;
  const messagesHref = `/jobs/${item.jobId}?view=messages`;

  // What the last call already established comes first.
  if (last?.outcome === "too_expensive" || soundsLikePrice(item.responseNote) || soundsLikePrice(last?.note)) {
    out.push({
      title: "Offer to trim it to the parts that matter",
      say: `Hi ${first}, it's ${"{you}"} from JS Landscaping. I know ${total} was more than you had in mind. Rather than lose you, could we pick the two or three things you most want done and I'll re-price just those? The link updates the moment I do.`,
      action: { label: "Take areas off the proposal", href: trimHref },
    });
    out.push({
      title: "Or spread it",
      say: "If it's the timing rather than the number, we can split it: part now and the rest over a few payments, same crew, same work.",
      action: null,
    });
  }

  if (last?.outcome === "wants_changes") {
    out.push({
      title: "Make the change on the evaluation and let the proposal follow",
      say: `You said you'd like it changed. Tell me exactly what, and I'll have the updated proposal back to you today.`,
      action: { label: "Enter the change", href: `/jobs/${item.jobId}?view=site` },
    });
  }

  if (last?.outcome === "thinking" || (item.status === "sent" && item.opens > 1 && !last)) {
    out.push({
      title: "Ask the one question",
      say: `What would make this a yes for you? If it's something on the proposal I can change it; if it's timing, tell me the month and I'll hold the price.`,
      action: null,
    });
  }

  // What they tapped on the page, answered in the words on the page.
  for (const id of item.objectionIds.slice(0, 2)) {
    const objection = objectionById(id);
    if (!objection) continue;
    const resolution = objection.resolutions[0];
    out.push({
      title: `They asked: “${objection.label}”`,
      say: objection.answer,
      action:
        resolution === "reduce_scope"
          ? { label: "Take areas off the proposal", href: trimHref }
          : resolution === "payment_plan"
            ? { label: "Their proposal", href: `/jobs/${item.jobId}` }
            : null,
    });
  }

  if (item.status === "sent" && item.opens === 0) {
    out.push({
      title: "They have not opened it",
      say: `Just checking the proposal reached you, ${first}. I'll text the link again now so it's easy to find. Anything you'd like me to walk you through?`,
      action: { label: "Message them the link", href: messagesHref },
    });
  } else if (item.status === "sent" && item.focus) {
    out.push({
      title: `They spent longest on ${item.focus}`,
      say: `I noticed you were looking at the ${item.focus.toLowerCase()} part. Anything there I can explain or change?`,
      action: null,
    });
  }

  if (item.status === "declined" && (last?.outcome === "went_elsewhere" || soundsLikeSomeoneElse(item.responseNote))) {
    out.push({
      title: "Ask who and why, then leave the door open",
      say: `No hard feelings at all. Can I ask what tipped it, price or timing or something else? And if anything comes up with the work, we're here.`,
      action: null,
    });
  } else if (item.status === "declined" && out.length === 0) {
    out.push({
      title: "Find out the real reason",
      say: `Hi ${first}, ${"{you}"} from JS Landscaping. I saw you passed on the proposal, totally fine. I'm just trying to learn: was it the price, the timing, or the plan itself?`,
      action: null,
    });
  }

  if (last?.outcome === "next_season" || last?.outcome === "call_back") {
    out.push({
      title: last.callbackOn ? `They asked for a call on ${last.callbackOn}` : "They asked for a call later",
      say: `You asked me to check back around now. Is it a good time to get you on the calendar? I can hold the price from the proposal.`,
      action: null,
    });
  }

  if (!item.phone) {
    out.push({
      title: "No phone on file",
      say: null,
      action: { label: "Message them through the proposal thread", href: messagesHref },
    });
  }

  if (out.length === 0) {
    out.push({
      title: "Check in",
      say: `Hi ${first}, it's ${"{you}"} from JS Landscaping. I sent the proposal for ${item.address} and wanted to see if you had any questions, or if there's a day that would suit you to get started.`,
      action: null,
    });
  }

  return out.slice(0, 3);
}

/**
 * The list, in two lanes.
 *
 * "Now" is everything due today or overdue, biggest first. "Later" is what
 * has a date on it, soonest first, so a promised callback is never lost
 * and never nags before its day.
 */
export function buildCallList(items: CallItem[], today: Date = new Date()): CallList {
  const todayKey = dayKey(today);
  const ranked: RankedCall[] = [];

  for (const item of items) {
    const last = item.calls[0] ?? null;
    if (last && closesTheCall(last.outcome)) continue;
    // A decline that has gone cold is history, not a call.
    if (item.status === "declined") {
      const sinceNo = daysBetween(item.respondedAt, today);
      if (sinceNo != null && sinceNo > DECLINED_WINDOW_DAYS && !last?.callbackOn) continue;
    }
    const due = dueOn(item);
    const { score, reason } = scoreCall(item, today);
    ranked.push({
      ...item,
      score,
      reason,
      lane: due && due > todayKey ? "later" : "now",
      dueOn: due,
      daysSinceSent: daysBetween(item.sentAt, today),
      recommendations: recommend(item),
      lastCall: last,
    });
  }

  const now = ranked.filter((r) => r.lane === "now").sort((a, b) => b.score - a.score);
  const later = ranked.filter((r) => r.lane === "later").sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const openCents = ranked.reduce((sum, r) => sum + (r.totalCents ?? 0), 0);
  return { now, later, openCents };
}

/** The date an outcome implies, when the person did not pick one. */
export function defaultCallbackOn(outcome: CallOutcome, today: Date = new Date()): string | null {
  if (outcome === "no_answer") return addDays(today, RETRY_DAYS);
  if (outcome === "next_season") return addDays(today, 60);
  if (outcome === "call_back") return addDays(today, 3);
  return null;
}

/** The headline over the list. */
export function callListHeadline(list: CallList): string {
  if (list.now.length === 0 && list.later.length === 0) return "Nobody to ring. Every proposal is either accepted or closed.";
  const total = `$${Math.round(list.openCents / 100).toLocaleString("en-US")}`;
  if (list.now.length === 0) return `Nothing due today. ${list.later.length} to ring later, ${total} on the table.`;
  return `${list.now.length} to ring today, ${total} on the table.`;
}
