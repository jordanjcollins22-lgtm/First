import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { leadSource, type LeadSource } from "@/lib/lead-sources";

export interface LeadRecord {
  createdAt: string;
  source: LeadSource;
  sold: boolean;
  revenue: number;
}

/**
 * Every lead of the last year (each job is one: an evaluation booked, a
 * quick mow ordered, a client added by hand) with where it came from, and
 * whether and for how much it sold. Grouped and counted on the page, so the
 * period can change without asking again.
 */
export async function listLeadSources(days = 365): Promise<LeadRecord[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(
      "id, created_at, referral_code, referred_by_profile_id, source_attractor_wave_id, ghl_appointment_id, " +
        "properties!inner(customers!inner(organization_id, source, referred_by_customer_id)), job_proposals(status, total_cost, discount_amount, paid_at)"
    )
    .eq("properties.customers.organization_id", organizationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) throw error;
  type JobRow = {
    id: string;
    created_at: string;
    referral_code: string | null;
    referred_by_profile_id: string | null;
    source_attractor_wave_id: string | null;
    ghl_appointment_id: string | null;
    properties: { customers: { source: string | null; referred_by_customer_id: string | null } | null } | null;
    job_proposals: { status: string; total_cost: number | null; discount_amount: number | null; paid_at: string | null }[] | { status: string; total_cost: number | null; discount_amount: number | null; paid_at: string | null } | null;
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
  const { data: profiles } = people.length
    ? await supabase.from("profiles").select("id, full_name, first_name, email").in("id", people)
    : { data: [] as { id: string; full_name: string | null; first_name: string | null; email: string }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, (p.first_name || p.full_name || p.email || "").split(" ")[0] || null]));
  const clickBy = new Map((clicks ?? []).map((c) => [c.job_id, c]));
  const linkBy = new Map((links ?? []).map((l) => [l.code, l]));
  const mowBy = new Map((mows ?? []).filter((m) => m.job_id).map((m) => [m.job_id as string, m]));

  return rows.map((j) => {
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
    return {
      createdAt: j.created_at,
      sold: proposalSold || mowSold,
      revenue,
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
}
