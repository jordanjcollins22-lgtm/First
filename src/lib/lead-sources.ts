/**
 * Where a lead came from, in one word the office would use. Every lead has
 * several possible clues; the most specific one wins: a paid ad click, then
 * the tracked link it came through (and what kind of link), then the
 * affiliate's own booking link, a door hanger campaign, a client's
 * referral, the old calendar, what was typed when it was added by hand, and
 * otherwise booked online with no trail. Pure, so it is tested.
 */

export interface LeadClues {
  adSource: string | null;
  adCampaign: string | null;
  gclid: boolean;
  fbclid: boolean;
  linkKind: string | null;
  linkPlatform: string | null;
  linkOwner: string | null;
  referredByName: string | null;
  campaignWave: boolean;
  clientReferral: boolean;
  fromOldCalendar: boolean;
  typedSource: string | null;
  quickMow: boolean;
}

export interface LeadSource {
  /** The group it is counted under. */
  group: string;
  /** The finer detail, e.g. which campaign or whose link. */
  detail: string | null;
}

const PLATFORM: Record<string, string> = { facebook: "Facebook", nextdoor: "Nextdoor", instagram: "Instagram", reddit: "Reddit" };

export function leadSource(c: LeadClues): LeadSource {
  if (c.gclid) return { group: "Google ad", detail: c.adCampaign };
  if (c.fbclid) return { group: "Facebook ad", detail: c.adCampaign };
  if (c.adSource) return { group: `Ad: ${c.adSource}`, detail: c.adCampaign };
  if (c.linkKind) {
    const where = PLATFORM[c.linkPlatform ?? ""] ?? "";
    const group =
      c.linkKind === "comment"
        ? `${where || "Social"} comment`
        : c.linkKind === "dm"
          ? `${where || "Social"} message`
          : c.linkKind === "post"
            ? `${where || "Social"} post`
            : c.linkKind === "flyer"
              ? "Flyer"
              : c.linkKind === "sign"
                ? "Yard sign"
                : "Tracked link";
    return { group, detail: c.linkOwner };
  }
  if (c.referredByName) return { group: "Affiliate's booking link", detail: c.referredByName };
  if (c.campaignWave) return { group: "Door hangers", detail: null };
  if (c.clientReferral) return { group: "Client referral", detail: null };
  if (c.quickMow) return { group: "Quick mow page", detail: null };
  if (c.fromOldCalendar) return { group: "GoHighLevel calendar", detail: null };
  if (c.typedSource && !/^tracked link/i.test(c.typedSource)) return { group: c.typedSource, detail: null };
  return { group: "Booked online, no trail", detail: null };
}

export interface SourceRow {
  group: string;
  leads: number;
  sold: number;
  revenue: number;
  details: { name: string; leads: number }[];
}

/** Leads grouped by source, most leads first, with how many sold and for how much. */
export function summariseSources(leads: { source: LeadSource; sold: boolean; revenue: number }[]): SourceRow[] {
  const byGroup = new Map<string, SourceRow>();
  for (const lead of leads) {
    const row = byGroup.get(lead.source.group) ?? { group: lead.source.group, leads: 0, sold: 0, revenue: 0, details: [] };
    row.leads += 1;
    if (lead.sold) {
      row.sold += 1;
      row.revenue += lead.revenue;
    }
    if (lead.source.detail) {
      const d = row.details.find((x) => x.name === lead.source.detail);
      if (d) d.leads += 1;
      else row.details.push({ name: lead.source.detail, leads: 1 });
    }
    byGroup.set(row.group, row);
  }
  return Array.from(byGroup.values())
    .map((r) => ({ ...r, details: r.details.sort((a, b) => b.leads - a.leads) }))
    .sort((a, b) => b.leads - a.leads || b.revenue - a.revenue);
}
