/**
 * The switches for the automated client messages built in workstream A2, and
 * the go-live guard every one of them shares.
 *
 * Each sequence ships off. Switching one on writes down the moment
 * (`startedAt`), and from then on the sequence only acts on records created or
 * changed after that moment. That is the whole defence against texting the
 * backlog: an invoice from last spring is not a reason to text anybody the
 * morning the switch goes on. The owner can still reach the backlog, but only
 * through a campaign they start by hand with a preview in front of them.
 *
 * Pure: it reads stored rows and answers questions. Nothing here sends.
 */

export const SEQUENCES = [
  "invoice_reminders",
  "review_requests",
  "proposal_follow_ups",
  "no_show_rebook",
  "win_back",
  "renewals",
  "salt_presell",
  "missed_call_text",
  "call_logging",
] as const;

export type SequenceKey = (typeof SEQUENCES)[number];

export function isSequenceKey(value: string): value is SequenceKey {
  return (SEQUENCES as readonly string[]).includes(value);
}

/** Everything a sequence can be told, all optional in storage. */
export interface SequenceConfig {
  /** review_requests: where a five-star rating is sent. */
  googleReviewLink?: string;
  /** review_requests: days before the one reminder. */
  reviewReminderDays?: number;
  /** review_requests: how long before a client may be asked again. */
  reviewCooldownMonths?: number;
  /** invoice_reminders: days past due before collections is told. */
  collectionsAfterDays?: number;
  /** proposal_follow_ups: days after sending, each with its channel. */
  followUpDays?: number[];
  /** no_show_rebook: days after the missed visit. */
  rebookDays?: number[];
  /** win_back: days after the decline. */
  winBackDays?: number[];
  /** renewals: price rise, in percent. */
  escalatorPct?: number;
  /** renewals: first day of the season, MM-DD. */
  seasonStart?: string;
  /** renewals: how many days before the season the campaign is due. */
  renewalLeadDays?: number;
}

export interface SequenceSetting {
  key: SequenceKey;
  enabled: boolean;
  /** When it was first switched on. Null until it has been. */
  startedAt: Date | null;
  config: Required<SequenceConfig>;
}

export const DEFAULT_CONFIG: Required<SequenceConfig> = {
  googleReviewLink: "",
  reviewReminderDays: 3,
  reviewCooldownMonths: 12,
  collectionsAfterDays: 28,
  followUpDays: [3, 7, 14, 21, 30],
  rebookDays: [0, 3],
  winBackDays: [30, 90, 180],
  escalatorPct: 4,
  seasonStart: "03-15",
  renewalLeadDays: 45,
};

export const SEQUENCE_LABEL: Record<SequenceKey, string> = {
  invoice_reminders: "Invoice reminders",
  review_requests: "Google review request",
  proposal_follow_ups: "Proposal follow-ups (5 touches)",
  no_show_rebook: "No-show rebook",
  win_back: "Win back declined proposals",
  renewals: "Renewal proposals",
  salt_presell: "Snow and salt pre-sell",
  missed_call_text: "Missed-call text-back",
  call_logging: "Calls logged from Twilio",
};

export const SEQUENCE_WHY: Record<SequenceKey, string> = {
  invoice_reminders: "3 days before the due date, on it, then 7 and 21 days late. After that the invoice comes to you as a collections item.",
  review_requests: "After the client approves the before and afters or pays. A 1–5 rating first: fives go on to Google, anything lower comes to you.",
  proposal_follow_ups: "Days 3, 7, 14, 21 and 30 after a proposal goes out, email and text in turn. Stops the moment they reply, accept, decline or it expires.",
  no_show_rebook: "A link to rebook the same day a visit is missed or the client cancels, and again on day 3. Stops when they book.",
  win_back: "30, 90 and 180 days after a decline, offering the most important part first at a price worked out from the areas.",
  renewals: "Last season's recurring clients get next season's proposal at the escalated price. You start it, after a preview.",
  salt_presell: "Past clients and business contacts are invited to prepay salt at /salt. You start it, after a preview.",
  missed_call_text: "A caller nobody answered gets a text within a minute: sorry we missed you, book here or reply. Once per number per day.",
  call_logging: "Calls through the business number are written down by themselves. Answered calls about a proposal wait for a one-tap outcome.",
};

/** The ones that send on a timer, rather than when the owner presses a button. */
export const CAMPAIGNS: SequenceKey[] = ["renewals", "salt_presell"];

function numberList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 400);
  return list.length > 0 ? [...new Set(list)].sort((a, b) => a - b) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** A review link worth sending: https, and nothing that could carry a script. */
export function cleanReviewLink(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Stored config, read onto the defaults. A bad value is the default, not an error. */
export function mergeConfig(stored: unknown): Required<SequenceConfig> {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const season = String(raw.seasonStart ?? "");
  return {
    googleReviewLink: cleanReviewLink(raw.googleReviewLink),
    reviewReminderDays: boundedNumber(raw.reviewReminderDays, DEFAULT_CONFIG.reviewReminderDays, 1, 14),
    reviewCooldownMonths: boundedNumber(raw.reviewCooldownMonths, DEFAULT_CONFIG.reviewCooldownMonths, 1, 36),
    collectionsAfterDays: boundedNumber(raw.collectionsAfterDays, DEFAULT_CONFIG.collectionsAfterDays, 22, 120),
    followUpDays: numberList(raw.followUpDays, DEFAULT_CONFIG.followUpDays).filter((d) => d >= 1 && d <= 60),
    rebookDays: numberList(raw.rebookDays, DEFAULT_CONFIG.rebookDays).filter((d) => d <= 14),
    winBackDays: numberList(raw.winBackDays, DEFAULT_CONFIG.winBackDays).filter((d) => d >= 7),
    escalatorPct: boundedNumber(raw.escalatorPct, DEFAULT_CONFIG.escalatorPct, 0, 25),
    seasonStart: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(season) ? season : DEFAULT_CONFIG.seasonStart,
    renewalLeadDays: boundedNumber(raw.renewalLeadDays, DEFAULT_CONFIG.renewalLeadDays, 7, 120),
  };
}

export interface StoredSetting {
  sequence: string;
  enabled: boolean | null;
  started_at: string | null;
  config: unknown;
}

/** Every sequence, stored or not. One never touched is off. */
export function mergeSettings(rows: readonly StoredSetting[]): Record<SequenceKey, SequenceSetting> {
  const out = {} as Record<SequenceKey, SequenceSetting>;
  for (const key of SEQUENCES) {
    const row = rows.find((r) => r.sequence === key);
    out[key] = {
      key,
      enabled: Boolean(row?.enabled),
      startedAt: row?.started_at ? new Date(row.started_at) : null,
      config: mergeConfig(row?.config),
    };
  }
  return out;
}

/**
 * Whether a sequence may act on a record that came into being, or changed,
 * at `recordAt`. Off is never; on is only for what happened since.
 */
export function isLiveFor(setting: Pick<SequenceSetting, "enabled" | "startedAt">, recordAt: Date | string | null | undefined): boolean {
  if (!setting.enabled || !setting.startedAt || !recordAt) return false;
  const at = recordAt instanceof Date ? recordAt : new Date(recordAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() >= setting.startedAt.getTime();
}

/**
 * What to store when a switch moves. The first time on sets the start; a
 * switch turned off and back on keeps it, because moving it forward would
 * quietly drop everything that arrived while it was off, and moving it back
 * is never needed.
 */
export function nextStartedAt(current: Date | null, enabled: boolean, now: Date): Date | null {
  if (current) return current;
  return enabled ? now : null;
}
