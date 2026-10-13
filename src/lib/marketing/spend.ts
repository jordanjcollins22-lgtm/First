/**
 * What each channel costs, against what it brought in.
 *
 * Spend arrives three ways: the Google Ads API (Search and Local Services
 * campaigns, split by campaign type), a CSV the owner uploads when there is
 * no API access, and the plays the app closes (door hangers, flyers, signs,
 * costed at their unit price). Leads come from the lead-source report,
 * which already works out where every booking came from; Local Services Ads
 * leads that never touched the booking page come from the platform itself.
 *
 * Cost per lead is spend over leads, and cost to win a client (CAC) is spend
 * over the leads that sold. Neither is ever shown when there is nothing to
 * divide by: "no leads yet" is an answer, $Infinity is not.
 *
 * Pure.
 */

export const SPEND_CHANNELS = ["google_ads", "google_lsa", "facebook_ads", "door_hangers", "eddm", "yard_signs", "other"] as const;
export type SpendChannel = (typeof SPEND_CHANNELS)[number];

export const SPEND_CHANNEL_LABEL: Record<SpendChannel, string> = {
  google_ads: "Google Search ads",
  google_lsa: "Google Local Services Ads",
  facebook_ads: "Facebook ads",
  door_hangers: "Door hangers",
  eddm: "Flyers by mail",
  yard_signs: "Yard signs",
  other: "Other",
};

export function isSpendChannel(v: string): v is SpendChannel {
  return (SPEND_CHANNELS as readonly string[]).includes(v);
}

export interface SpendRow {
  channel: SpendChannel;
  day: string;
  amountCents: number;
  clicks: number | null;
  impressions: number | null;
  platformLeads: number | null;
  campaign: string | null;
  externalKey: string;
}

/** One row of the Ads API's campaign report, as it answers in JSON. */
export interface AdsRow {
  segments?: { date?: string };
  campaign?: { id?: string; name?: string; advertisingChannelType?: string };
  metrics?: { costMicros?: string | number; clicks?: string | number; impressions?: string | number; conversions?: string | number };
}

/** The API's rows as spend: LOCAL_SERVICES campaigns are LSA, everything else Search ads. */
export function adsRowsToSpend(rows: readonly AdsRow[]): SpendRow[] {
  const out: SpendRow[] = [];
  for (const r of rows) {
    const day = r.segments?.date;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const channel: SpendChannel = r.campaign?.advertisingChannelType === "LOCAL_SERVICES" ? "google_lsa" : "google_ads";
    const micros = Number(r.metrics?.costMicros ?? 0) || 0;
    out.push({
      channel,
      day,
      amountCents: Math.round(micros / 10_000),
      clicks: Number(r.metrics?.clicks ?? 0) || 0,
      impressions: Number(r.metrics?.impressions ?? 0) || 0,
      platformLeads: Math.round(Number(r.metrics?.conversions ?? 0) || 0),
      campaign: r.campaign?.name ?? null,
      externalKey: `${channel}:${day}:${r.campaign?.id ?? "all"}`,
    });
  }
  return out;
}

export interface LsaLeadRow {
  localServicesLead?: {
    id?: string | number;
    leadType?: string;
    categoryId?: string;
    contactDetails?: { phoneNumber?: string };
    leadCharged?: boolean;
    creationDateTime?: string;
  };
}

export interface PlatformLead {
  externalId: string;
  leadType: string | null;
  category: string | null;
  charged: boolean | null;
  phone: string | null;
  occurredAt: string | null;
}

/** "2026-10-03 14:22:05" (account time) as an ISO string; kept as given when unreadable. */
function adsDateTime(v: string | undefined): string | null {
  if (!v) return null;
  const iso = v.includes("T") ? v : v.replace(" ", "T");
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}

export function lsaLeads(rows: readonly LsaLeadRow[]): PlatformLead[] {
  return rows
    .map((r) => r.localServicesLead)
    .filter((l): l is NonNullable<LsaLeadRow["localServicesLead"]> => Boolean(l?.id))
    .map((l) => ({
      externalId: String(l.id),
      leadType: l.leadType ?? null,
      category: l.categoryId ?? null,
      charged: typeof l.leadCharged === "boolean" ? l.leadCharged : null,
      phone: l.contactDetails?.phoneNumber ?? null,
      occurredAt: adsDateTime(l.creationDateTime),
    }));
}

// ---------------------------------------------------------------------------
// CSV, for when there is no API access.

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const HEADERS = {
  day: ["date", "day"],
  amount: ["cost", "spend", "amount", "amount spent", "amount spent (usd)", "cost (usd)"],
  channel: ["channel", "source"],
  campaign: ["campaign", "campaign name"],
  clicks: ["clicks"],
  impressions: ["impressions", "impr.", "impr"],
  leads: ["leads", "conversions", "conv.", "charged leads"],
} as const;

function findColumn(header: string[], names: readonly string[]): number {
  return header.findIndex((h) => names.includes(h.toLowerCase().replace(/\s+/g, " ").trim()));
}

/** "10/3/2026", "2026-10-03", "Oct 3, 2026" → "2026-10-03". */
export function csvDay(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(v);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/** "$1,234.56" → 123456 cents. */
export function csvCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function csvInt(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Spend rows from a CSV export (Google Ads, LSA, Facebook Ads Manager, or a
 * sheet typed by hand). Title lines above the header, as Google's exports
 * have, are skipped. Rows with no channel column go to `defaultChannel`.
 * Rows for one channel, day and campaign add up, so a per-ad export still
 * imports as one row a day.
 */
export function parseSpendCsv(text: string, defaultChannel: SpendChannel): { rows: SpendRow[]; problems: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const problems: string[] = [];
  let headerAt = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = splitCsvLine(lines[i]);
    if (findColumn(cells, HEADERS.day) >= 0 && findColumn(cells, HEADERS.amount) >= 0) {
      headerAt = i;
      header = cells;
      break;
    }
  }
  if (headerAt < 0) return { rows: [], problems: ["No header row with a date column and a cost column was found."] };
  const col = {
    day: findColumn(header, HEADERS.day),
    amount: findColumn(header, HEADERS.amount),
    channel: findColumn(header, HEADERS.channel),
    campaign: findColumn(header, HEADERS.campaign),
    clicks: findColumn(header, HEADERS.clicks),
    impressions: findColumn(header, HEADERS.impressions),
    leads: findColumn(header, HEADERS.leads),
  };
  const merged = new Map<string, SpendRow>();
  for (let i = headerAt + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (/^total/i.test(cells[0] ?? "")) continue;
    const day = csvDay(cells[col.day] ?? "");
    const cents = csvCents(cells[col.amount] ?? "");
    if (!day || cents == null) {
      problems.push(`Line ${i + 1} skipped: no readable date or cost.`);
      continue;
    }
    const rawChannel = col.channel >= 0 ? (cells[col.channel] ?? "").toLowerCase().replace(/[\s-]+/g, "_") : "";
    const channel = isSpendChannel(rawChannel) ? rawChannel : defaultChannel;
    const campaign = col.campaign >= 0 ? cells[col.campaign] || null : null;
    const key = `${channel}:${day}:${campaign ?? "all"}`;
    const row = merged.get(key) ?? {
      channel,
      day,
      amountCents: 0,
      clicks: null,
      impressions: null,
      platformLeads: null,
      campaign,
      externalKey: `csv:${key}`,
    };
    row.amountCents += cents;
    const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
    row.clicks = add(row.clicks, col.clicks >= 0 ? csvInt(cells[col.clicks]) : null);
    row.impressions = add(row.impressions, col.impressions >= 0 ? csvInt(cells[col.impressions]) : null);
    row.platformLeads = add(row.platformLeads, col.leads >= 0 ? csvInt(cells[col.leads]) : null);
    merged.set(key, row);
  }
  return { rows: [...merged.values()], problems: problems.slice(0, 20) };
}

// ---------------------------------------------------------------------------
// The dashboard.

/** Which spend a lead-source group is paid for by, if any. */
export function channelOfLeadGroup(group: string): SpendChannel | null {
  const g = group.toLowerCase();
  if (g === "google ad" || g === "ad: google" || g === "ad: google ads") return "google_ads";
  if (g === "facebook ad" || g === "ad: facebook" || g === "ad: fb" || g === "ad: meta") return "facebook_ads";
  if (g === "door hangers") return "door_hangers";
  if (g === "flyer") return "eddm";
  if (g === "yard sign") return "yard_signs";
  return null;
}

export interface LeadLine {
  group: string;
  createdAt: string;
  sold: boolean;
  revenue: number;
}

export interface ChannelLine {
  /** The spend channel, or null for a channel nothing is paid for (referrals, repeat). */
  channel: SpendChannel | null;
  label: string;
  leads: number;
  sold: number;
  revenueCents: number;
  spendCents: number;
  costPerLeadCents: number | null;
  cacCents: number | null;
}

export interface ChannelReport {
  days: number;
  lines: ChannelLine[];
  leads: number;
  sold: number;
  revenueCents: number;
  spendCents: number;
  /** Spend over revenue, or null with no revenue. */
  spendShare: number | null;
  band: "under" | "on" | "over" | null;
}

export function spendBand(share: number | null, low: number, high: number): ChannelReport["band"] {
  if (share == null) return null;
  if (share < low) return "under";
  if (share > high) return "over";
  return "on";
}

/**
 * Leads, sales, revenue and spend by channel for the last `days` days.
 * Platform leads (LSA) count as leads for their channel; they are
 * phone calls that never reached the booking page.
 */
export function channelReport(input: {
  leads: readonly LeadLine[];
  spend: readonly { channel: string; day: string; amountCents: number }[];
  platformLeads: readonly { provider: string; occurredAt: string | null }[];
  days: number;
  now: Date;
  targetLow: number;
  targetHigh: number;
}): ChannelReport {
  const cutoff = input.now.getTime() - input.days * 86_400_000;
  const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
  const by = new Map<string, ChannelLine>();
  const line = (key: string, channel: SpendChannel | null, label: string) => {
    const existing = by.get(key);
    if (existing) return existing;
    const created: ChannelLine = { channel, label, leads: 0, sold: 0, revenueCents: 0, spendCents: 0, costPerLeadCents: null, cacCents: null };
    by.set(key, created);
    return created;
  };
  for (const lead of input.leads) {
    if (Date.parse(lead.createdAt) < cutoff) continue;
    const channel = channelOfLeadGroup(lead.group);
    const l = channel ? line(channel, channel, SPEND_CHANNEL_LABEL[channel]) : line(`group:${lead.group}`, null, lead.group);
    l.leads++;
    if (lead.sold) {
      l.sold++;
      l.revenueCents += Math.round(lead.revenue * 100);
    }
  }
  for (const p of input.platformLeads) {
    if (!p.occurredAt || Date.parse(p.occurredAt) < cutoff) continue;
    const channel: SpendChannel = p.provider === "google_lsa" ? "google_lsa" : isSpendChannel(p.provider) ? p.provider : "other";
    line(channel, channel, SPEND_CHANNEL_LABEL[channel]).leads++;
  }
  for (const s of input.spend) {
    if (s.day < cutoffDay) continue;
    const channel: SpendChannel = isSpendChannel(s.channel) ? s.channel : "other";
    line(channel, channel, SPEND_CHANNEL_LABEL[channel]).spendCents += s.amountCents;
  }
  const lines = [...by.values()].map((l) => ({
    ...l,
    costPerLeadCents: l.spendCents > 0 && l.leads > 0 ? Math.round(l.spendCents / l.leads) : null,
    cacCents: l.spendCents > 0 && l.sold > 0 ? Math.round(l.spendCents / l.sold) : null,
  }));
  lines.sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads || b.spendCents - a.spendCents);
  const leads = lines.reduce((n, l) => n + l.leads, 0);
  const sold = lines.reduce((n, l) => n + l.sold, 0);
  const revenueCents = lines.reduce((n, l) => n + l.revenueCents, 0);
  const spendCents = lines.reduce((n, l) => n + l.spendCents, 0);
  const spendShare = revenueCents > 0 ? spendCents / revenueCents : null;
  return {
    days: input.days,
    lines,
    leads,
    sold,
    revenueCents,
    spendCents,
    spendShare,
    band: spendBand(spendShare, input.targetLow, input.targetHigh),
  };
}
