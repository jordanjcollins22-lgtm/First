import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { proposalPath } from "@/lib/proposal-flow";
import { priceBreakdown, type JobFee, type PriceBreakdown } from "@/lib/price-approval";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { THUMBNAIL } from "@/lib/storage-image-url";

export interface PriceApproval {
  jobId: string;
  client: string;
  address: string;
  /** Who the proposal would be emailed to. Null when there is no email on file. */
  email: string | null;
  /** Who did the walkthrough. */
  evaluator: string | null;
  submittedAt: string | null;
  /** Price it: accept or decline. Send: priced, not sent to the client yet. */
  stage: "price" | "send";
  /** What the client would be quoted, after any discount, in cents. */
  totalCents: number;
  proposalHref: string | null;
  breakdown: PriceBreakdown;
  /** Who is paid a share of the price: the affiliate who brought it in, or else the client's account manager. */
  fee: JobFee;
  crewRateCents: number;
  markup: string;
  /** Each area's walkthrough photos, as images to show, in the order of breakdown.areas. */
  areaPhotos: string[][];
  /** The whole site map, as the proposal draws it. Sample: the practice drawing, with no photo behind it. */
  siteMap:
    | { kind: "image"; imagePath: string; transform: ProposalSiteImageTransform; zones: Pick<ProposalZoneSnapshot, "zoneName" | "color" | "points">[] }
    | { kind: "sample"; zones: { name: string; color: string; points: { x: number; y: number }[] }[] }
    | null;
}

/**
 * The walkthroughs waiting on the account manager: submitted and not
 * priced yet, then priced and not sent. For owners, admins and account
 * managers; null for anybody else.
 */
export async function getPriceApprovals(): Promise<PriceApproval[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) return null;

  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("job_proposals")
    .select(
      "job_id, status, total_cost, discount_amount, sent_at, token, generated_at, site_image_path, site_image_transform, scope_snapshot, job:jobs!inner(id, status, evaluation_submitted_at, referral_code, referred_by_profile_id, assignee:profiles!jobs_assigned_to_fkey(full_name, email), property:properties(address, customer:customers(name, email, account_manager_id)))"
    )
    .in("status", ["needs_approval", "sent"])
    .order("generated_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  type Row = {
    job_id: string;
    status: string;
    total_cost: number | null;
    discount_amount: number | null;
    sent_at: string | null;
    token: string | null;
    generated_at: string | null;
    site_image_path: string | null;
    site_image_transform: ProposalSiteImageTransform | null;
    scope_snapshot: ProposalZoneSnapshot[] | null;
    job: {
      id: string;
      status: string;
      evaluation_submitted_at: string | null;
      referral_code: string | null;
      referred_by_profile_id: string | null;
      assignee: { full_name: string | null; email: string | null } | null;
      property: { address: string | null; customer: { name: string | null; email: string | null; account_manager_id: string | null } | null } | null;
    };
  };
  // Waiting on a price, or priced lately and not sent to the client yet.
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.job.status !== "cancelled" && (r.status === "needs_approval" || (!r.sent_at && (r.generated_at ?? "") >= since))
  );
  if (rows.length === 0) return [];

  const codes = [...new Set(rows.map((r) => r.job.referral_code).filter((c): c is string => Boolean(c)))];
  const [catalog, designs, people, links] = await Promise.all([
    getCanvasCatalog(),
    supabase.from("canvas_designs").select("job_id, zones").in("job_id", rows.map((r) => r.job_id)),
    supabase.from("profiles").select("id, full_name, email, commission_pct").eq("organization_id", profile.organization_id),
    codes.length > 0
      ? supabase.from("outreach_links").select("code, profile_id").eq("organization_id", profile.organization_id).in("code", codes)
      : Promise.resolve({ data: [] as { code: string; profile_id: string }[] }),
  ]);
  const personById = new Map((people.data ?? []).map((p) => [p.id, p]));
  const posterByCode = new Map((links.data ?? []).map((l) => [l.code, l.profile_id]));
  const firstName = (id: string) => {
    const p = personById.get(id);
    return (p?.full_name || p?.email || "").trim().split(/[\s@]/)[0] || null;
  };
  const pctOf = (id: string) => {
    const pct = personById.get(id)?.commission_pct;
    return pct == null ? DEFAULT_ACCOUNT_MANAGER_PCT : Number(pct);
  };
  // The affiliate whose link or name brought the job in is paid their
  // share; otherwise the client's account manager is.
  const feeFor = (r: Row): JobFee => {
    const affiliate = r.job.referred_by_profile_id ?? (r.job.referral_code ? posterByCode.get(r.job.referral_code) : undefined);
    if (affiliate && personById.has(affiliate)) return { kind: "affiliate", name: firstName(affiliate) ?? "Affiliate", pct: pctOf(affiliate) };
    const manager = r.job.property?.customer?.account_manager_id;
    if (manager && personById.has(manager)) return { kind: "account-manager", name: firstName(manager) ?? "Account manager", pct: pctOf(manager) };
    return { kind: "account-manager", name: "Account manager", pct: DEFAULT_ACCOUNT_MANAGER_PCT };
  };
  const zonesByJob = new Map((designs.data ?? []).map((d) => [d.job_id as string, (d.zones ?? []) as unknown as WorkZone[]]));
  const m = catalog.markup;
  const markup =
    m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0
      ? `× ${m.multiplier}, then + $${(m.overheadPerCrewHourCents / 100).toFixed(2)} a crew-hour overhead`
      : `× ${m.multiplier}, then + ${m.overheadPercent}% overhead`;

  return rows.map((r) => {
    const breakdown = priceBreakdown(zonesByJob.get(r.job_id) ?? [], catalog);
    return {
      jobId: r.job_id,
      client: r.job.property?.customer?.name || "Client",
      address: r.job.property?.address ?? "",
      email: r.job.property?.customer?.email?.trim() || null,
      evaluator: r.job.assignee?.full_name || r.job.assignee?.email || null,
      submittedAt: r.job.evaluation_submitted_at ?? r.generated_at,
      stage: r.status === "needs_approval" ? ("price" as const) : ("send" as const),
      totalCents: Math.round((Number(r.total_cost ?? 0) - Number(r.discount_amount ?? 0)) * 100),
      // The client's own page, in preview: it shows before it is sent, with a
      // banner saying so, and the office opening it is not counted as the client.
      proposalHref: r.token ? `${proposalPath(r.token)}?preview=1` : null,
      breakdown,
      fee: feeFor(r),
      crewRateCents: catalog.crewCostPerHourCents,
      markup,
      areaPhotos: breakdown.areas.map((a) => a.photoPaths.map((path) => canvasImageUrl(path, THUMBNAIL))),
      siteMap:
        r.site_image_path && r.site_image_transform
          ? { kind: "image" as const, imagePath: r.site_image_path, transform: r.site_image_transform, zones: r.scope_snapshot ?? [] }
          : null,
    };
  });
}
