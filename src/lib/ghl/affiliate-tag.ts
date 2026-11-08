/**
 * Whose GoHighLevel link a booking came through.
 *
 * GoHighLevel keeps the page a contact booked or filled a form on
 * (attributionSource.url for the first visit, lastAttributionSource.url for
 * the latest), query string and all. A person's link carries a tag there:
 *
 *  - am_id=<id>, GoHighLevel's own Affiliate Manager link (what Jace and
 *    Justin were handing out, e.g. am_id=jaceburgess465), or
 *  - ref=<their app affiliate code>, the tagged GoHighLevel link the app
 *    gives everyone (ghlBookingLink below).
 *
 * The "Affiliate Source" contact field is read too, for a booking where the
 * office typed it in. Pure, so the crediting rule is tested.
 */

export const TAG_PARAMS = ["ref", "am_id"] as const;

const clean = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().slice(0, 80) : "");

/** The tag on one GoHighLevel contact, or null when there is none. The latest visit wins over the first. */
export function ghlAffiliateTag(contact: Record<string, unknown> | null, affiliateFieldId?: string | null): string | null {
  if (!contact) return null;
  for (const key of ["lastAttributionSource", "attributionSource"]) {
    const url = (contact[key] as Record<string, unknown> | undefined)?.url;
    if (typeof url !== "string" || !url) continue;
    try {
      const params = new URL(url).searchParams;
      for (const p of TAG_PARAMS) {
        const tag = clean(params.get(p));
        if (tag) return tag;
      }
    } catch {
      // Not a URL GoHighLevel could have recorded a tag on.
    }
  }
  if (affiliateFieldId) {
    const custom = (contact.customFields ?? contact.customField) as { id?: string; value?: unknown }[] | undefined;
    const own = Array.isArray(custom) ? custom.find((f) => f?.id === affiliateFieldId) : undefined;
    const tag = clean(own?.value);
    if (tag) return tag;
  }
  return null;
}

export interface TagPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Their app affiliate code (profiles.affiliate_slug), the ref= on their tagged link. */
  affiliateSlug: string | null;
  /** Owners never take the affiliate share. */
  isOwner: boolean;
}

export interface TagCredit {
  profileId: string;
  /** First name, as the reports show people. */
  name: string;
  /** Whether they take the 4%: anybody but an owner. */
  earns: boolean;
}

const letters = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Who a tag belongs to. Their own code (an app affiliate code or one of their
 * tracked link codes) first; otherwise a GoHighLevel affiliate id made of
 * their name, e.g. "jaceburgess465" for Jace Burgess, or of their first name
 * alone ("justin2412"). Only a single clear
 * match counts: a tag two people could own credits nobody, and shows up on
 * the monthly check instead.
 */
export function creditTag(tag: string | null, people: TagPerson[], linkOwners: Map<string, string> = new Map()): TagCredit | null {
  const t = clean(tag);
  if (!t) return null;
  const toCredit = (p: TagPerson): TagCredit => ({
    profileId: p.id,
    name: (p.firstName || p.fullName || "").trim().split(/\s+/)[0] || "A team member",
    earns: !p.isOwner,
  });
  const bySlug = people.find((p) => clean(p.affiliateSlug) === t);
  if (bySlug) return toCredit(bySlug);
  const linkOwner = linkOwners.get(t);
  const byLink = linkOwner ? people.find((p) => p.id === linkOwner) : undefined;
  if (byLink) return toCredit(byLink);
  const name = letters(t);
  if (name.length < 4) return null;
  const hits = people.filter((p) => {
    const whole = letters(p.firstName) && letters(p.lastName) ? letters(p.firstName) + letters(p.lastName) : letters(p.fullName);
    return whole.length >= 4 && whole === name;
  });
  if (hits.length) return hits.length === 1 ? toCredit(hits[0]) : null;
  // A GoHighLevel id of just a first name ("justin2412"), when only one person has it.
  const first = people.filter((p) => letters((p.firstName || p.fullName || "").trim().split(/\s+/)[0]) === name);
  return first.length === 1 ? toCredit(first[0]) : null;
}

/** The person's own GoHighLevel booking link, tagged with their app affiliate code. */
export function ghlBookingLink(base: string, slug: string | null): string | null {
  if (!base || !slug) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("ref", slug);
    return url.toString();
  } catch {
    return null;
  }
}

export interface TagCheckRow extends LeadTag {
  leads: number;
  sold: number;
  collected: number;
}

/** What a lead records about the GoHighLevel tag it came with. */
export interface LeadTag {
  tag: string;
  /** Who it was credited to, or null when nobody matched (then it is not paid: it goes to the channel). */
  person: string | null;
  /** Credited to an owner, who never takes it. */
  owner: boolean;
}

/**
 * The monthly check: every tag GoHighLevel recorded, who it was credited to,
 * and what came of it. A tag with no person is one to fix (give them their
 * tagged link, or set their name), and is not paid until it is.
 */
export function tagCheck(leads: { ghlTag?: LeadTag | null; sold: boolean; collected: number }[]): TagCheckRow[] {
  const by = new Map<string, TagCheckRow>();
  for (const l of leads) {
    const t = l.ghlTag;
    if (!t) continue;
    const row = by.get(t.tag) ?? { tag: t.tag, person: t.person, owner: t.owner, leads: 0, sold: 0, collected: 0 };
    row.leads += 1;
    if (l.sold) row.sold += 1;
    row.collected = Math.round((row.collected + (l.collected > 0 ? l.collected : 0)) * 100) / 100;
    by.set(row.tag, row);
  }
  return [...by.values()].sort((a, b) => b.leads - a.leads || a.tag.localeCompare(b.tag));
}
