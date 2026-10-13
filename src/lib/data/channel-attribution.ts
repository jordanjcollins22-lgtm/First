import type { SupabaseClient } from "@supabase/supabase-js";

import { attributionReport } from "@/lib/data/attribution";
import { listLeadSources } from "@/lib/data/lead-sources";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { createClient } from "@/lib/supabase/server";
import { channelReport, type ChannelReport, type LeadLine } from "@/lib/marketing/spend";

/**
 * Leads, sales and revenue by channel for the last 30, 90 and 365 days,
 * with spend where it is known.
 *
 * Built from the two reports that already exist: the lead-source report
 * (where every booking came from, most specific clue first) and the
 * attribution report (which campaigns reached the address). A lead the
 * first could only call "booked online, no trail" takes the second's door
 * hanger credit when that credit was recorded or the only campaign in
 * range, and never otherwise.
 *
 * Spend is everything in marketing_spend (Google Ads and LSA by API, any
 * CSV, anything typed) plus what the finished plays cost.
 */

export interface ChannelAttribution {
  periods: ChannelReport[];
  hasSpend: boolean;
  targetLow: number;
  targetHigh: number;
}

const PLAY_CHANNEL: Record<string, string> = { door_hangers: "door_hangers", knocks: "door_hangers", yard_sign: "yard_signs", flyers: "eddm" };

export async function loadChannelAttribution(target: { low: number; high: number }, now = new Date()): Promise<ChannelAttribution> {
  const sb = (await createClient()) as unknown as SupabaseClient;
  const org = await getCurrentOrganizationId();
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const sinceDay = since.toISOString().slice(0, 10);

  const [leads, attribution, { data: spendRows }, { data: playRows }, { data: platformRows }] = await Promise.all([
    listLeadSources(365).catch(() => []),
    attributionReport(365).catch(() => null),
    sb.from("marketing_spend").select("channel, day, amount_cents").eq("organization_id", org).gte("day", sinceDay).limit(20000),
    sb
      .from("marketing_plays")
      .select("kind, cost_cents, done_at")
      .eq("organization_id", org)
      .eq("status", "done")
      .not("cost_cents", "is", null)
      .gte("done_at", since.toISOString())
      .limit(5000),
    sb.from("marketing_platform_leads").select("provider, occurred_at").eq("organization_id", org).gte("occurred_at", since.toISOString()).limit(5000),
  ]);

  const hangerJobs = new Set(
    (attribution?.jobs ?? [])
      .filter((j) => j.attribution.channel === "door_hanger" && (j.attribution.confidence === "recorded" || j.attribution.confidence === "inferred"))
      .map((j) => j.jobId)
  );
  const lines: LeadLine[] = leads.map((l) => ({
    group: l.source.group === "Booked online, no trail" && hangerJobs.has(l.jobId) ? "Door hangers" : l.source.group,
    createdAt: l.createdAt,
    sold: l.sold,
    revenue: l.revenue,
  }));

  const spend = [
    ...((spendRows ?? []) as { channel: string; day: string; amount_cents: number }[]).map((r) => ({ channel: r.channel, day: r.day, amountCents: r.amount_cents })),
    ...((playRows ?? []) as { kind: string; cost_cents: number; done_at: string }[]).map((p) => ({
      channel: PLAY_CHANNEL[p.kind] ?? "other",
      day: p.done_at.slice(0, 10),
      amountCents: p.cost_cents,
    })),
  ];
  const platformLeads = ((platformRows ?? []) as { provider: string; occurred_at: string | null }[]).map((p) => ({ provider: p.provider, occurredAt: p.occurred_at }));

  const periods = [30, 90, 365].map((days) =>
    channelReport({ leads: lines, spend, platformLeads, days, now, targetLow: target.low, targetHigh: target.high })
  );
  return { periods, hasSpend: spend.some((s) => s.amountCents > 0), targetLow: target.low, targetHigh: target.high };
}
