/**
 * Lead generation as a routine somebody can be handed.
 *
 * The business does not have a marketing problem, it has a bus-factor problem:
 * the ways it wins work live in one person's head, so when that person is away
 * nobody books an evaluation and the calendar goes quiet three weeks later.
 *
 * The fix is not more channels. It is a written playbook per channel, a number
 * to hit each day, and a log of what was actually done — so somebody who has
 * never made a cold call can open the page, read the steps, and get through
 * thirty of them without asking anybody.
 *
 * Two axes rather than one, because they answer different questions.
 * Temperature decides what you say. Cost decides what somebody with no budget
 * can still get on with this morning.
 */

export type Temperature = "cold" | "warm" | "inbound";
export type CostType = "free" | "paid";

export const TEMPERATURE_LABELS: Record<Temperature, string> = {
  cold: "Cold",
  warm: "Warm",
  inbound: "Inbound",
};

export const TEMPERATURE_BLURBS: Record<Temperature, string> = {
  cold: "They have never heard of us. Volume matters more than polish.",
  warm: "They know us already. These convert several times better and cost nothing.",
  inbound: "They come to us. Slow to build, keeps working while nobody is doing anything.",
};

export const COST_LABELS: Record<CostType, string> = { free: "Free", paid: "Costs money" };

/**
 * What happened. Ordered from least to most progress, which is also the order
 * they appear on the logging buttons.
 *
 * "attempted" is deliberately first and deliberately cheap to record: thirty
 * calls nobody logged is a day nobody can learn from, and if logging a
 * no-answer takes more than one tap it will not happen.
 */
export type Outcome = "attempted" | "reached" | "interested" | "booked" | "not_interested" | "do_not_contact";

export const OUTCOMES: Outcome[] = [
  "attempted",
  "reached",
  "interested",
  "booked",
  "not_interested",
  "do_not_contact",
];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  attempted: "No answer",
  reached: "Spoke to them",
  interested: "Interested",
  booked: "Booked an evaluation",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

/** Outcomes where somebody actually made contact — the denominator for how
 * well the pitch is working, as opposed to how much dialling is happening. */
const REACHED: Outcome[] = ["reached", "interested", "booked", "not_interested", "do_not_contact"];

export interface ChannelShape {
  id: string;
  key: string;
  name: string;
  temperature: Temperature;
  costType: CostType;
  summary: string | null;
  playbook: string | null;
  dailyTarget: number | null;
  active: boolean;
  sortOrder: number;
}

export interface TouchShape {
  channelId: string;
  outcome: Outcome;
  day: string;
  profileId: string | null;
}

export interface ChannelProgress {
  channel: ChannelShape;
  /** Logged today. */
  today: number;
  target: number | null;
  /** 0–1, or null when the channel has no daily rhythm. */
  fraction: number | null;
  /** Still to do today. Null when there is no target to fall short of. */
  remaining: number | null;
  done: boolean;
}

export interface ChannelResults {
  channelId: string;
  attempts: number;
  reached: number;
  booked: number;
  /** Booked evaluations per hundred attempts. The only number that matters. */
  bookedPer100: number | null;
  /** Of the people actually spoken to, how many booked. */
  closeRate: number | null;
}

/** Steps, one per line, with the leading "1." stripped — the numbering is the
 * list's job, not the text's, and a stored "1." goes stale the moment somebody
 * inserts a step. */
export function playbookSteps(playbook: string | null): string[] {
  if (!playbook) return [];
  return playbook
    .split("\n")
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ""))
    .filter((line) => line.length > 0);
}

export function progressFor(
  channels: ChannelShape[],
  touches: TouchShape[],
  today: string
): ChannelProgress[] {
  const todayCounts = new Map<string, number>();
  for (const touch of touches) {
    if (touch.day !== today) continue;
    todayCounts.set(touch.channelId, (todayCounts.get(touch.channelId) ?? 0) + 1);
  }

  return channels
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((channel) => {
      const count = todayCounts.get(channel.id) ?? 0;
      const target = channel.dailyTarget;
      return {
        channel,
        today: count,
        target,
        fraction: target && target > 0 ? Math.min(1, count / target) : null,
        remaining: target && target > 0 ? Math.max(0, target - count) : null,
        done: target != null && target > 0 ? count >= target : false,
      };
    });
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * How each channel is actually performing, over whatever period was fetched.
 *
 * Channels with no touches at all are still returned, at zero. A channel that
 * disappears from the table when nobody works it is a channel nobody notices
 * they have stopped working.
 */
export function resultsFor(channels: ChannelShape[], touches: TouchShape[]): ChannelResults[] {
  const byChannel = new Map<string, TouchShape[]>(channels.map((c) => [c.id, []]));
  for (const touch of touches) {
    byChannel.get(touch.channelId)?.push(touch);
  }

  return channels.map((channel) => {
    const rows = byChannel.get(channel.id) ?? [];
    const attempts = rows.length;
    const reached = rows.filter((r) => REACHED.includes(r.outcome)).length;
    const booked = rows.filter((r) => r.outcome === "booked").length;
    return {
      channelId: channel.id,
      attempts,
      reached,
      booked,
      bookedPer100: attempts === 0 ? null : Math.round((booked / attempts) * 1000) / 10,
      closeRate: rate(booked, reached),
    };
  });
}

export interface DaySummary {
  logged: number;
  target: number;
  booked: number;
  /** Channels with a daily target that has been met. */
  channelsDone: number;
  channelsWithTarget: number;
}

/** The one line at the top: did the team do the work today, and did it land. */
export function summariseDay(progress: ChannelProgress[], touches: TouchShape[], today: string): DaySummary {
  const todays = touches.filter((t) => t.day === today);
  const withTarget = progress.filter((p) => p.target != null && p.target > 0);

  return {
    logged: todays.length,
    target: withTarget.reduce((sum, p) => sum + (p.target ?? 0), 0),
    booked: todays.filter((t) => t.outcome === "booked").length,
    channelsDone: withTarget.filter((p) => p.done).length,
    channelsWithTarget: withTarget.length,
  };
}
