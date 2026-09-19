import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isMissingTable } from "@/lib/setup-errors";
import {
  progressFor,
  resultsFor,
  summariseDay,
  type ChannelProgress,
  type ChannelResults,
  type ChannelShape,
  type DaySummary,
  type TouchShape,
} from "@/lib/outreach";

/** Local day, not a UTC instant — an evening call belongs to the day the
 * person was working, not the day Greenwich had rolled over into. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface OutreachData {
  day: string;
  channels: ChannelShape[];
  progress: ChannelProgress[];
  /** Performance over the trailing window, per channel. */
  results: ChannelResults[];
  summary: DaySummary;
  /** How many days the results cover, for the label. */
  windowDays: number;
  /** True when migration 0084 hasn't been run — the page says so rather than
   * looking merely empty. */
  setupNeeded: boolean;
}

const WINDOW_DAYS = 30;

const EMPTY: OutreachData = {
  day: localDay(),
  channels: [],
  progress: [],
  results: [],
  summary: { logged: 0, target: 0, booked: 0, channelsDone: 0, channelsWithTarget: 0 },
  windowDays: WINDOW_DAYS,
  setupNeeded: true,
};

/**
 * The day's plan and how the channels have been doing.
 *
 * Two queries: the channels, and a month of touches. A month rather than all
 * time because a conversion rate from two summers ago is not evidence about
 * what to do this morning, and because it keeps the read small enough to run
 * on every page load from a phone.
 */
export async function getOutreach(now: Date = new Date()): Promise<OutreachData> {
  const supabase = await createClient();
  const day = localDay(now);

  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WINDOW_DAYS - 1));
  const sinceKey = localDay(since);

  const [channelsRes, touchesRes] = await Promise.all([
    supabase.from("outreach_channels").select("*").order("sort_order"),
    supabase.from("outreach_touches").select("channel_id, outcome, day, profile_id").gte("day", sinceKey),
  ]);

  if (isMissingTable(channelsRes.error)) return { ...EMPTY, day };
  if (channelsRes.error) throw channelsRes.error;

  const channels: ChannelShape[] = (
    (channelsRes.data ?? []) as unknown as {
      id: string;
      key: string;
      name: string;
      temperature: ChannelShape["temperature"];
      cost_type: ChannelShape["costType"];
      summary: string | null;
      playbook: string | null;
      daily_target: number | null;
      active: boolean;
      sort_order: number;
    }[]
  ).map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    temperature: c.temperature,
    costType: c.cost_type,
    summary: c.summary,
    playbook: c.playbook,
    dailyTarget: c.daily_target,
    active: c.active,
    sortOrder: c.sort_order,
  }));

  const touches: TouchShape[] = (
    (touchesRes.data ?? []) as unknown as {
      channel_id: string;
      outcome: TouchShape["outcome"];
      day: string;
      profile_id: string | null;
    }[]
  ).map((t) => ({ channelId: t.channel_id, outcome: t.outcome, day: t.day, profileId: t.profile_id }));

  const progress = progressFor(channels, touches, day);

  return {
    day,
    channels,
    progress,
    results: resultsFor(channels, touches),
    summary: summariseDay(progress, touches, day),
    windowDays: WINDOW_DAYS,
    setupNeeded: false,
  };
}

/** Used by the log action to stamp the row with the right org. */
export async function currentOrgId(): Promise<string> {
  return getCurrentOrganizationId();
}
