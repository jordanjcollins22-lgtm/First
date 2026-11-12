/**
 * The Communications Board: every message from every channel, one card per
 * person, moved through six lanes.
 *
 *   Backlog -> Breakdown -> Answer · Doing / Answer · Track -> Validate · Doing -> Validate · Done
 *
 * Pure: nothing here reads the database or the clock unless it is handed
 * one, so the rules Jordan set are tested rather than hoped for. The data
 * layer (lib/data/comms-board.ts) turns rows into BoardMessage, and the
 * actions (lib/actions/comms-board-actions.ts) store CardState.
 */

import type { CardAction, IntentId, Question, Resource } from "@/lib/comms-intents";

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ChannelId =
  | "sms"
  | "call"
  | "voicemail"
  | "email"
  | "app"
  | "form"
  | "fb_dm"
  | "ig_dm"
  | "fb_comment"
  | "ig_comment"
  | "fb_mention"
  | "ig_mention"
  | "google"
  | "mail"
  | "nextdoor"
  | "tiktok"
  | "other";

export interface ChannelInfo {
  label: string;
  /** The chip it is filtered under. */
  group: string;
  /** "live": a webhook or sync stores it. "hand": only through Add a message. */
  feed: "live" | "hand";
  /** "app": Yes sends through the app's own send path. "hand": Yes marks it reply by hand. */
  send: "app" | "hand";
}

export const CHANNELS: Record<ChannelId, ChannelInfo> = {
  sms: { label: "Text", group: "Text", feed: "live", send: "app" },
  call: { label: "Phone call", group: "Phone", feed: "live", send: "hand" },
  voicemail: { label: "Voicemail", group: "Phone", feed: "hand", send: "hand" },
  email: { label: "Email", group: "Email", feed: "live", send: "app" },
  app: { label: "Client page", group: "Website", feed: "live", send: "app" },
  form: { label: "Website form", group: "Website", feed: "live", send: "hand" },
  fb_dm: { label: "Facebook DM", group: "Facebook", feed: "live", send: "app" },
  ig_dm: { label: "Instagram DM", group: "Instagram", feed: "live", send: "app" },
  fb_comment: { label: "Facebook comment", group: "Facebook", feed: "hand", send: "hand" },
  ig_comment: { label: "Instagram comment", group: "Instagram", feed: "hand", send: "hand" },
  fb_mention: { label: "Facebook mention", group: "Facebook", feed: "hand", send: "hand" },
  ig_mention: { label: "Instagram mention", group: "Instagram", feed: "hand", send: "hand" },
  google: { label: "Google review", group: "Google", feed: "live", send: "app" },
  mail: { label: "Letter", group: "Mail", feed: "hand", send: "hand" },
  nextdoor: { label: "Nextdoor", group: "Nextdoor", feed: "hand", send: "hand" },
  tiktok: { label: "TikTok", group: "TikTok", feed: "hand", send: "hand" },
  other: { label: "Other", group: "Other", feed: "hand", send: "hand" },
};

export const CHANNEL_GROUPS = ["All", "Text", "Phone", "Email", "Website", "Facebook", "Instagram", "Google", "Mail", "Nextdoor", "TikTok", "Other"] as const;

/** The channels Add a message offers: every one, since a call or a DM can be noted by hand too. */
export const HAND_CHANNELS = (Object.keys(CHANNELS) as ChannelId[]).filter((c) => c !== "app");

export function isChannel(v: unknown): v is ChannelId {
  return typeof v === "string" && v in CHANNELS;
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export type Lane = "backlog" | "breakdown" | "doing" | "track" | "validate" | "done";

export const LANES: { id: Lane; name: string; limit?: number }[] = [
  { id: "backlog", name: "Backlog" },
  { id: "breakdown", name: "Breakdown" },
  { id: "doing", name: "Answer · Doing" },
  { id: "track", name: "Answer · Track" },
  { id: "validate", name: "Validate · Doing", limit: 1 },
  { id: "done", name: "Validate · Done" },
];

export function isLane(v: unknown): v is Lane {
  return typeof v === "string" && LANES.some((l) => l.id === v);
}

// ---------------------------------------------------------------------------
// Messages and people
// ---------------------------------------------------------------------------

export interface BoardMessage {
  id: string;
  channel: ChannelId;
  /** "in" from them, "out" from us. */
  direction: "in" | "out";
  text: string;
  /** ISO time. */
  at: string;
  name?: string | null;
  customerId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Someone with no phone or email: "fb:<id>", "ig:<id>", "google:<review>". */
  handle?: string | null;
  jobId?: string | null;
  /** Where a reply on this channel goes. */
  ref?: { pageRowId?: string; platform?: string; contactId?: string; reviewId?: string; lastIncomingAt?: string } | null;
}

export interface Person {
  key: string;
  name: string;
  customerId: string | null;
  phones: string[];
  emails: string[];
  handles: string[];
  jobIds: string[];
  /** Oldest first. */
  messages: BoardMessage[];
}

export function last10(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function emailKey(email: string | null | undefined): string {
  const e = String(email ?? "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

/** Every key that says "this is the same person". */
function keysOf(m: BoardMessage): string[] {
  const keys: string[] = [];
  if (m.customerId) keys.push(`c:${m.customerId}`);
  const p = last10(m.phone);
  if (p) keys.push(`p:${p}`);
  const e = emailKey(m.email);
  if (e) keys.push(`e:${e}`);
  if (m.handle) keys.push(`h:${m.handle}`);
  if (keys.length === 0) keys.push(`m:${m.id}`);
  return keys;
}

/**
 * One person per set of messages that share a customer, a phone number, an
 * email address or a social handle, whichever channel each arrived on. A text
 * from a number and an email from an address both on the same customer join;
 * so does a later text from that number after the customer row is gone.
 */
export function groupByPerson(messages: BoardMessage[]): Person[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cur = k;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  for (const m of messages) {
    const keys = keysOf(m);
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (const k of keys.slice(1)) union(keys[0], k);
  }

  const groups = new Map<string, BoardMessage[]>();
  for (const m of messages) {
    const root = find(keysOf(m)[0]);
    const list = groups.get(root) ?? [];
    list.push(m);
    groups.set(root, list);
  }

  const people: Person[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    const customerId = uniq(sorted.map((m) => m.customerId))[0] ?? null;
    const phones = uniq(sorted.map((m) => m.phone));
    const emails = uniq(sorted.map((m) => m.email));
    const handles = uniq(sorted.map((m) => m.handle));
    // The name they gave most recently on a message from them, else ours.
    const named = [...sorted].reverse().find((m) => m.name && m.direction === "in") ?? [...sorted].reverse().find((m) => m.name);
    const key = customerId
      ? `c:${customerId}`
      : last10(phones[0])
        ? `p:${last10(phones[0])}`
        : emailKey(emails[0])
          ? `e:${emailKey(emails[0])}`
          : handles[0]
            ? `h:${handles[0]}`
            : `m:${sorted[0].id}`;
    people.push({
      key,
      name: named?.name?.trim() || phones[0] || emails[0] || "Someone",
      customerId,
      phones,
      emails,
      handles,
      jobIds: uniq([...sorted].reverse().map((m) => m.jobId)),
      messages: sorted,
    });
  }
  // Newest conversation first.
  return people.sort((a, b) => lastAt(b).localeCompare(lastAt(a)) || a.key.localeCompare(b.key));
}

export function lastAt(p: { messages: BoardMessage[] }): string {
  return p.messages[p.messages.length - 1]?.at ?? "";
}

// ---------------------------------------------------------------------------
// Have we already answered? Would this be a double text?
// ---------------------------------------------------------------------------

export interface ReplyCheck {
  /** Our last message is newer than their last: nothing is owed. */
  alreadyReplied: boolean;
  /** How many of ours in a row at the end: one more would be a double text. */
  ourStreak: number;
  /** Their messages since we last said anything, oldest first: all of them must be read. */
  unread: BoardMessage[];
  lastIn: BoardMessage | null;
  lastOut: BoardMessage | null;
}

export function replyCheck(messages: BoardMessage[]): ReplyCheck {
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  let lastIn: BoardMessage | null = null;
  let lastOut: BoardMessage | null = null;
  for (const m of sorted) {
    if (m.direction === "in") lastIn = m;
    else lastOut = m;
  }
  let ourStreak = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].direction === "out"; i--) ourStreak += 1;
  const unread = sorted.filter((m) => m.direction === "in" && (!lastOut || m.at > lastOut.at));
  return {
    alreadyReplied: Boolean(lastOut && (!lastIn || lastOut.at >= lastIn.at)),
    ourStreak,
    unread,
    lastIn,
    lastOut,
  };
}

/**
 * Whether a reply prepared from their messages up to `basedOn` may go now.
 * Checked again on the server at the moment of Yes, against fresh messages.
 */
export function canSend(
  messages: BoardMessage[],
  basedOn: string | null | undefined
): { ok: true } | { ok: false; reason: "new_message" | "already_replied" | "nothing_to_answer" } {
  const check = replyCheck(messages);
  if (check.lastIn && basedOn && check.lastIn.at > basedOn) return { ok: false, reason: "new_message" };
  if (check.alreadyReplied) return { ok: false, reason: "already_replied" };
  if (!check.lastIn) return { ok: false, reason: "nothing_to_answer" };
  return { ok: true };
}

export const SEND_REFUSALS: Record<"new_message" | "already_replied" | "nothing_to_answer", string> = {
  new_message: "They wrote again. The reply was cancelled and is being redone from all their messages.",
  already_replied: "Somebody already replied to them, so this would be a double text. Nothing was sent.",
  nothing_to_answer: "They haven't written anything to answer.",
};

// ---------------------------------------------------------------------------
// Where a reply goes
// ---------------------------------------------------------------------------

/**
 * The channel to answer on: the one they last wrote on when the app can send
 * there, else a text, else an email, else by hand on the channel they used.
 */
export function replyChannel(person: Pick<Person, "messages" | "phones" | "emails" | "jobIds">): { channel: ChannelId; byHand: boolean } {
  const lastIn = [...person.messages].reverse().find((m) => m.direction === "in");
  const on = lastIn?.channel ?? "sms";
  const hasJob = person.jobIds.length > 0;
  if (CHANNELS[on].send === "app") {
    if (on === "sms" || on === "email" || on === "app") {
      if (hasJob && (on !== "sms" || person.phones.length) && (on !== "email" || person.emails.length)) return { channel: on, byHand: false };
    } else {
      return { channel: on, byHand: false };
    }
  }
  if (hasJob && person.phones.length) return { channel: "sms", byHand: false };
  if (hasJob && person.emails.length) return { channel: "email", byHand: false };
  return { channel: on, byHand: true };
}

// ---------------------------------------------------------------------------
// Card state and lanes
// ---------------------------------------------------------------------------

export interface NoReason {
  why: string;
  at: string;
}

export interface SentRecord {
  body: string;
  channel: ChannelId;
  at: string;
  byHand: boolean;
  /** What the action did, when there was one: "Booked Tue Nov 17". */
  did?: string | null;
}

/** What is saved for a card (comms_board_cards, migration 0373). */
export interface CardState {
  personKey: string;
  lane: Lane;
  intent?: IntentId | null;
  intentSummary?: string | null;
  resources?: Resource[];
  action?: CardAction | null;
  question?: Question | null;
  answer?: string | null;
  draft?: string | null;
  draftChannel?: ChannelId | null;
  draftByHand?: boolean;
  /** The newest message of theirs the breakdown and draft read. */
  basedOn?: string | null;
  cancelledAt?: string | null;
  noReasons?: NoReason[];
  sent?: SentRecord | null;
  followUpOn?: string | null;
  updatedAt?: string | null;
}

export interface BoardCard extends CardState {
  person: Person;
  /** Cancelled because they wrote again while it was being worked. */
  restarted: boolean;
  /** Somebody answered from the inbox while it was here. */
  repliedElsewhere: boolean;
  /** Drafted and waiting for its turn in Validate · Doing. */
  ready: boolean;
}

const IN_PROGRESS: Lane[] = ["breakdown", "doing", "validate"];

/**
 * Where a person's card is, from what was saved and what has been said since.
 *
 * - No saved state: unanswered goes to Backlog, answered to Answer · Track.
 * - A new message from them while it is being worked cancels the work and
 *   sends it back to Breakdown, to be redone from every message.
 * - A new message after it was sent or parked brings it back to Backlog.
 * - Answered from somewhere else while being worked: Answer · Track, never a
 *   second reply.
 */
export function deriveCard(person: Person, state: CardState | null | undefined): BoardCard {
  const check = replyCheck(person.messages);
  const newestIn = check.lastIn?.at ?? null;
  const base: BoardCard = {
    personKey: person.key,
    lane: "backlog",
    noReasons: [],
    ...(state ?? {}),
    person,
    restarted: false,
    repliedElsewhere: false,
    ready: false,
  };

  if (!state) {
    base.lane = check.alreadyReplied || !check.lastIn ? "track" : "backlog";
    return base;
  }

  const working = IN_PROGRESS.includes(state.lane) || (state.lane === "track" && Boolean(state.question) && !state.answer);
  if (working) {
    if (newestIn && state.basedOn && newestIn > state.basedOn) {
      return {
        ...base,
        lane: "breakdown",
        restarted: true,
        cancelledAt: state.cancelledAt ?? newestIn,
        draft: null,
        intent: null,
        intentSummary: null,
        resources: [],
        action: null,
        question: null,
        answer: null,
      };
    }
    if (check.alreadyReplied && check.lastOut && (!state.basedOn || check.lastOut.at > state.basedOn)) {
      return { ...base, lane: "track", repliedElsewhere: true, draft: null };
    }
    return { ...base, ready: state.lane === "doing" && Boolean(state.draft) };
  }

  if (state.lane === "track" || state.lane === "done") {
    const since = state.sent?.at ?? state.updatedAt ?? state.basedOn ?? null;
    if (newestIn && since && newestIn > since && !check.alreadyReplied) return { ...base, lane: "backlog" };
    return base;
  }

  // Backlog: answered from the inbox already means it is waiting on them.
  if (check.alreadyReplied) return { ...base, lane: "track", repliedElsewhere: true };
  return base;
}

/**
 * Validate · Doing holds one card. The one that got there first keeps it;
 * any other drafted card waits in Answer · Doing marked ready, and the oldest
 * ready card moves up as soon as the lane is empty.
 */
export function oneInValidate(cards: BoardCard[]): BoardCard[] {
  const byAge = (a: BoardCard, b: BoardCard) =>
    String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")) || a.personKey.localeCompare(b.personKey);
  const contenders = cards.filter((c) => c.lane === "validate" || (c.lane === "doing" && c.ready && c.draft)).sort((a, b) => {
    // Already in Validate wins over waiting in Doing.
    if (a.lane !== b.lane) return a.lane === "validate" ? -1 : 1;
    return byAge(a, b);
  });
  const chosen = contenders[0]?.personKey ?? null;
  return cards.map((c) => {
    if (c.personKey === chosen) return { ...c, lane: "validate" as Lane, ready: false };
    if (c.lane === "validate") return { ...c, lane: "doing" as Lane, ready: Boolean(c.draft) };
    return c;
  });
}

/** Every card, in its lane. */
export function buildBoard(people: Person[], states: CardState[]): BoardCard[] {
  const byKey = new Map(states.map((s) => [s.personKey, s]));
  return oneInValidate(people.map((p) => deriveCard(p, byKey.get(p.key))));
}

export function cardsIn(cards: BoardCard[], lane: Lane, group: string = "All"): BoardCard[] {
  return cards.filter((c) => c.lane === lane && inGroup(c, group));
}

export function groupsOf(card: { person: Person }): string[] {
  return [...new Set(card.person.messages.map((m) => CHANNELS[m.channel].group))];
}

export function inGroup(card: { person: Person }, group: string): boolean {
  return group === "All" || groupsOf(card).includes(group);
}

// ---------------------------------------------------------------------------
// Yes and No
// ---------------------------------------------------------------------------

/** One-tap reasons for a No. A typed reason works as well. */
export const NO_REASONS = ["Wrong price", "Wrong action", "Wrong tone", "Missing info", "Don't reply", "Call them instead"];

/** A No needs a why: picked reasons, typed text, or both. Null when it has one. */
export function noWhy(picked: string[], typed: string): { why: string } | { error: string } {
  const parts = [...picked.map((p) => p.trim()).filter(Boolean), typed.trim()].filter(Boolean);
  if (parts.length === 0) return { error: "Say why, so Claude can fix it." };
  return { why: parts.join(". ").slice(0, 600) };
}

/** A No: back to Answer · Doing with the why, the draft gone, to be redone. */
export function applyNo(state: CardState, why: string, now: string): CardState {
  return {
    ...state,
    lane: "doing",
    draft: null,
    noReasons: [...(state.noReasons ?? []), { why, at: now }],
    updatedAt: now,
  };
}

/** A Yes that went out: Validate · Done with what was sent. */
export function applySent(state: CardState, sent: SentRecord): CardState {
  return { ...state, lane: "done", sent, question: null, updatedAt: sent.at };
}

/** Initials for the avatar. */
export function initials(name: string): string {
  const letters = name
    .replace(/[^A-Za-z& ]/g, "")
    .split(/\s+/)
    .filter((w) => w && w !== "&")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return letters || "@";
}
