import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { DataScope } from "@/lib/data/review-scope";
import { ghlBookingBase, ghlContactClues, type GhlClues } from "@/lib/data/ghl-funnel";
import { creditTag, ghlBookingLink, type LeadTag, type TagPerson } from "@/lib/ghl/affiliate-tag";
import { leadSource, type LeadSource } from "@/lib/lead-sources";
import { loadMoney } from "@/lib/data/commission";
import { isOwnerLevel } from "@/lib/roles";

export interface LeadRecord {
  /** The job the lead is, so other reports can join on it. */
  jobId: string;
  createdAt: string;
  source: LeadSource;
  sold: boolean;
  revenue: number;
  /** What the client actually paid on the job so far. */
  collected: number;
  /**
   * Whether a person who earns the affiliate share brought it in: whoever's
   * booking link or tracked link it came through, unless that is an owner.
   * When nobody did, the affiliate's 4% goes to the channel's growth budget.
   */
  hasAffiliate: boolean;
  /** The first name of the person who earns that 4%, when one does. */
  affiliate: string | null;
  /** Came in through a tracked link on one of our posts: the content profit pool counts it. */
  fromContent: boolean;
  /** The job's profit in dollars, as its estimate worked it out, or null when it has none. */
  profit: number | null;
  /** The tag GoHighLevel recorded from the link it was booked through (am_id or ref), and whose it is. */
  ghlTag: LeadTag | null;
}

/**
 * Every lead of the last year (each job is one: an evaluation booked, a
 * quick mow ordered, a client added by hand) with where it came from, and
 * whether and for how much it sold. Grouped and counted on the page, so the
 * period can change without asking again.
 */
export async function listLeadSources(days = 365, scope?: DataScope): Promise<LeadRecord[]> {
  const supabase = scope?.client ?? (await createClient());
  const organizationId = scope?.organizationId ?? (await getCurrentOrganizationId());
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(
      "id, created_at, referral_code, referred_by_profile_id, source_attractor_wave_id, ghl_appointment_id, " +
        "properties!inner(customers!inner(organization_id, source, referred_by_customer_id, ghl_contact_id)), job_proposals(status, total_cost, discount_amount, paid_at, estimate)"
    )
    .eq("properties.customers.organization_id", organizationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) throw error;
  type ProposalRow = { status: string; total_cost: number | null; discount_amount: number | null; paid_at: string | null; estimate: { grossCents?: number } | null };
  type JobRow = {
    id: string;
    created_at: string;
    referral_code: string | null;
    referred_by_profile_id: string | null;
    source_attractor_wave_id: string | null;
    ghl_appointment_id: string | null;
    properties: { customers: { source: string | null; referred_by_customer_id: string | null; ghl_contact_id: string | null } | null } | null;
    job_proposals: ProposalRow[] | ProposalRow | null;
  };
  const rows = (jobs ?? []) as unknown as JobRow[];
  const ids = rows.map((j) => j.id);
  const codes = Array.from(new Set(rows.map((j) => j.referral_code).filter((c): c is string => Boolean(c))));

  const [{ data: clicks }, { data: links }, { data: mows }] = await Promise.all([
    ids.length
      ? supabase.from("job_ad_clicks").select("job_id, gclid, gbraid, wbraid, fbc, utm_source, utm_campaign").in("job_id", ids)
      : Promise.resolve({ data: [] as { job_id: string; gclid: string | null; gbraid: string | null; wbraid: string | null; fbc: string | null; utm_source: string | null; utm_campaign: string | null }[] }),
    codes.length
      ? supabase.from("outreach_links").select("code, kind, platform, profile_id").in("code", codes)
      : Promise.resolve({ data: [] as { code: string; kind: string; platform: string; profile_id: string }[] }),
    ids.length ? supabase.from("mow_orders").select("job_id, amount_cents, paid_at").in("job_id", ids) : Promise.resolve({ data: [] as { job_id: string | null; amount_cents: number | null; paid_at: string | null }[] }),
  ]);

  const people = Array.from(
    new Set([...(links ?? []).map((l) => l.profile_id), ...rows.map((j) => j.referred_by_profile_id)].filter((p): p is string => Boolean(p)))
  );
  const soldIds = rows.filter((j) => {
    const p = Array.isArray(j.job_proposals) ? j.job_proposals[0] : j.job_proposals;
    return Boolean(p && (p.status === "accepted" || p.paid_at));
  }).map((j) => j.id);
  const [{ data: profiles }, { data: personRoles }, money] = await Promise.all([
    people.length
      ? supabase.from("profiles").select("id, full_name, first_name, email").in("id", people)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; first_name: string | null; email: string }[] }),
    people.length
      ? supabase.from("profile_roles").select("profile_id, role_name").in("profile_id", people)
      : Promise.resolve({ data: [] as { profile_id: string; role_name: string }[] }),
    // What clients actually paid, for the channel growth budget. Only sold
    // jobs can have money in, so only they are asked about.
    loadMoney(soldIds, scope?.client).catch(() => null),
  ]);
  const rolesOf = new Map<string, string[]>();
  for (const r of (personRoles ?? []) as { profile_id: string; role_name: string }[]) rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  const earnsShare = (id: string | null | undefined) => Boolean(id && !isOwnerLevel(rolesOf.get(id) ?? []));
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, (p.first_name || p.full_name || p.email || "").split(" ")[0] || null]));
  const clickBy = new Map((clicks ?? []).map((c) => [c.job_id, c]));
  const linkBy = new Map((links ?? []).map((l) => [l.code, l]));
  const mowBy = new Map((mows ?? []).filter((m) => m.job_id).map((m) => [m.job_id as string, m]));

  const records = rows.map((j) => {
    const click = clickBy.get(j.id);
    const link = j.referral_code ? linkBy.get(j.referral_code) : undefined;
    const customer = j.properties?.customers ?? null;
    const mow = mowBy.get(j.id);
    const proposal = Array.isArray(j.job_proposals) ? j.job_proposals[0] : j.job_proposals;
    const proposalSold = Boolean(proposal && (proposal.status === "accepted" || proposal.paid_at));
    const mowSold = Boolean(mow?.paid_at);
    const revenue = proposalSold
      ? Math.max(0, Number(proposal?.total_cost ?? 0) - Number(proposal?.discount_amount ?? 0))
      : mowSold
        ? Number(mow?.amount_cents ?? 0) / 100
        : 0;
    // A quick mow paid by card can land in payments too, so the larger of the two, never both.
    const collected = Math.max(money?.collected.get(j.id) ?? 0, mow?.paid_at ? Number(mow.amount_cents ?? 0) / 100 : 0);
    return {
      jobId: j.id,
      createdAt: j.created_at,
      sold: proposalSold || mowSold,
      revenue,
      collected,
      hasAffiliate: earnsShare(j.referred_by_profile_id ?? link?.profile_id),
      affiliate: earnsShare(j.referred_by_profile_id ?? link?.profile_id)
        ? nameOf.get((j.referred_by_profile_id ?? link?.profile_id) as string) ?? "A team member"
        : null,
      fromContent: link?.kind === "post",
      profit: proposalSold && typeof proposal?.estimate?.grossCents === "number" ? proposal.estimate.grossCents / 100 : null,
      ghlTag: null as LeadTag | null,
      source: leadSource({
        adSource: click?.utm_source ?? null,
        adCampaign: click?.utm_campaign ?? null,
        gclid: Boolean(click?.gclid || click?.gbraid || click?.wbraid),
        fbclid: Boolean(click?.fbc),
        linkKind: link?.kind ?? (j.referral_code ? "other" : null),
        linkPlatform: link?.platform ?? null,
        linkOwner: link ? nameOf.get(link.profile_id) ?? null : null,
        referredByName: j.referred_by_profile_id ? nameOf.get(j.referred_by_profile_id) ?? "A team member" : null,
        campaignWave: Boolean(j.source_attractor_wave_id),
        clientReferral: Boolean(customer?.referred_by_customer_id),
        fromOldCalendar: Boolean(j.ghl_appointment_id),
        typedSource: customer?.source ?? null,
        quickMow: Boolean(mow),
      }),
    };
  });
  // GoHighLevel is asked about two kinds of lead: one that only says it came
  // through GoHighLevel (or left no trail), split by the funnel field it keeps
  // on the contact; and one nobody is credited with yet, in case it was booked
  // through a person's GoHighLevel link (lib/ghl/affiliate-tag.ts).
  const vague = new Set(["GoHighLevel calendar", "Booked online, no trail"]);
  const contactOf = new Map(rows.map((j) => [j.id, j.properties?.customers?.ghl_contact_id ?? null]));
  const codeOf = new Map(rows.map((j) => [j.id, j.referral_code]));
  const isVague = (r: LeadRecord) => vague.has(r.source.group) && !r.source.detail;
  const uncredited = (r: LeadRecord) => !r.hasAffiliate && !codeOf.get(r.jobId) && !r.fromContent;
  const ask = records.filter((r) => isVague(r) || uncredited(r)).map((r) => contactOf.get(r.jobId)).filter((c): c is string => Boolean(c));
  const clues = await ghlContactClues(ask).catch(() => new Map<string, GhlClues>());
  const tags = [...new Set([...clues.values()].map((c) => c.tag).filter((t): t is string => Boolean(t)))];
  const { people: tagPeople, linkOwners } = tags.length ? await tagOwners(supabase, organizationId, tags) : { people: [], linkOwners: new Map<string, string>() };
  for (const r of records) {
    const contact = contactOf.get(r.jobId);
    const c = contact ? clues.get(contact) : undefined;
    if (!c) continue;
    if (c.tag && uncredited(r)) {
      const credit = creditTag(c.tag, tagPeople, linkOwners);
      r.ghlTag = { tag: c.tag, person: credit?.name ?? null, owner: Boolean(credit && !credit.earns) };
      if (credit) {
        r.source = { group: "Affiliate's GoHighLevel link", detail: credit.name };
        if (credit.earns) {
          r.hasAffiliate = true;
          r.affiliate = credit.name;
        }
        continue;
      }
    }
    if (c.funnel && isVague(r)) r.source = { ...r.source, detail: c.funnel };
  }
  return records;
}

/** Everybody in the business a GoHighLevel tag could belong to, and the tracked link codes among the tags. */
async function tagOwners(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
  tags: string[]
): Promise<{ people: TagPerson[]; linkOwners: Map<string, string> }> {
  const [{ data: profiles }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, full_name, affiliate_slug").eq("organization_id", organizationId).limit(2000),
    tags.length
      ? supabase.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId).in("code", tags)
      : Promise.resolve({ data: [] }),
  ]);
  type P = { id: string; first_name: string | null; last_name: string | null; full_name: string | null; affiliate_slug: string | null };
  const list = (profiles ?? []) as P[];
  const { data: roles } = list.length
    ? await supabase.from("profile_roles").select("profile_id, role_name").in("profile_id", list.map((p) => p.id))
    : { data: [] };
  const rolesOf = new Map<string, string[]>();
  for (const r of (roles ?? []) as { profile_id: string; role_name: string }[]) rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  return {
    people: list.map((p) => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      fullName: p.full_name,
      affiliateSlug: p.affiliate_slug,
      isOwner: isOwnerLevel(rolesOf.get(p.id) ?? []),
    })),
    linkOwners: new Map(((links ?? []) as { code: string; profile_id: string }[]).map((l) => [l.code.toLowerCase(), l.profile_id])),
  };
}

/**
 * The marketing team, for the content profit pool: everybody who hands out
 * tracked links, by first name, the owner aside.
 */
export async function listMarketingTeam(scope?: DataScope): Promise<string[]> {
  const supabase = scope?.client ?? (await createClient());
  const organizationId = scope?.organizationId ?? (await getCurrentOrganizationId());
  const { data: links, error } = await supabase.from("outreach_links").select("profile_id").eq("organization_id", organizationId).limit(5000);
  if (error) throw error;
  const ids = Array.from(new Set((links ?? []).map((l) => l.profile_id as string | null).filter((p): p is string => Boolean(p))));
  if (!ids.length) return [];
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, first_name, email").in("id", ids),
    supabase.from("profile_roles").select("profile_id, role_name").in("profile_id", ids),
  ]);
  const rolesOf = new Map<string, string[]>();
  for (const r of (roles ?? []) as { profile_id: string; role_name: string }[]) rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  return ((profiles ?? []) as { id: string; full_name: string | null; first_name: string | null; email: string }[])
    .filter((p) => !isOwnerLevel(rolesOf.get(p.id) ?? []))
    .map((p) => (p.first_name || p.full_name || p.email || "").split(" ")[0] || "Someone")
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Each team member's tagged GoHighLevel booking link (lib/ghl/affiliate-tag.ts),
 * for the owner to hand out. Anybody but an owner who has an app affiliate
 * code; a booking through it is credited to them.
 */
export async function listGhlLinks(scope?: DataScope): Promise<{ name: string; link: string }[]> {
  const base = ghlBookingBase();
  if (!base) return [];
  const supabase = scope?.client ?? (await createClient());
  const organizationId = scope?.organizationId ?? (await getCurrentOrganizationId());
  const { people } = await tagOwners(supabase, organizationId, []);
  return people
    .filter((p) => !p.isOwner && p.affiliateSlug)
    .map((p) => ({
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.fullName || "A team member",
      link: ghlBookingLink(base, p.affiliateSlug) as string,
    }))
    .filter((r) => r.link)
    .sort((a, b) => a.name.localeCompare(b.name));
}
