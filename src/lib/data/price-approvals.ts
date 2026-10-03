import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { proposalPath } from "@/lib/proposal-flow";
import { priceBreakdown, type JobFee, type PriceBreakdown } from "@/lib/price-approval";
import { feesForJobs } from "@/lib/data/job-fee";
import { wordingToApprove } from "@/lib/data/scope-reviews";
import { env } from "@/lib/env";
import { travelForProperty } from "@/lib/data/job-travel";
import { jobCosts, priceSiteMap, type JobCosts } from "@/lib/job-price";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { PREVIEW, THUMBNAIL } from "@/lib/storage-image-url";
import { DEFAULT_SETUP, suggestJob, type PriceLine, type PricingSetup } from "@/lib/forward-pricing";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { zoneMeasurements } from "@/lib/proposal-pricing";
import { isSalting } from "@/lib/salting";

export interface ApprovalProduct {
  name: string;
  amount: string;
  cents: number | null;
  /** Its photo, when the inventory has one. */
  imageUrl: string | null;
  /** Where to see or buy it, when the inventory has a link. */
  url: string | null;
  /** In the inventory at all: when not, there is nowhere to put a photo or link yet. */
  inInventory: boolean;
}

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
  /**
   * Areas whose recommended wording nobody has approved or declined yet. The
   * price cannot be accepted until there are none; it is done on the site map.
   */
  wordingToApprove: string[];
  /** Where on the project that wording is approved or declined. */
  reviewHref: string;
  /** What the client would be quoted, after any discount, in cents. */
  totalCents: number;
  proposalHref: string | null;
  breakdown: PriceBreakdown;
  /** Who is paid a share of the price: the affiliate who brought it in, or else the client's account manager. */
  fee: JobFee;
  /** What the job costs us, line by line, travel and whole hours in, and the price it works out at. */
  costs: JobCosts;
  /** Every product going in: how much, what it costs, and its photo and where to buy it, from the inventory. */
  products: ApprovalProduct[];
  crewRateCents: number;
  markup: string;
  /** Each area's walkthrough photos, as images to show, in the order of breakdown.areas. */
  areaPhotos: string[][];
  /**
   * Each area as the forward pricing equation prices it, in the order of
   * breakdown.areas: what the evaluator wrote about it, every photo at full
   * size, and its services, as saved when it was approved or else suggested
   * from the walkthrough.
   */
  forward: ForwardArea[] | null;
  /** The crew, pay and production rates the forward price is worked out with. */
  pricing: PricingSetup;
  /** The whole site map, as the proposal draws it. Sample: the practice drawing, with no photo behind it. */
  siteMap:
    | { kind: "image"; imagePath: string; transform: ProposalSiteImageTransform; zones: Pick<ProposalZoneSnapshot, "zoneName" | "color" | "points">[] }
    | { kind: "sample"; zones: { name: string; color: string; points: { x: number; y: number }[] }[] }
    | null;
}

export interface ForwardArea {
  /** What the evaluator wrote about the area. */
  notes: string | null;
  /** Its walkthrough photos, large, for looking through them one by one. */
  photos: string[];
  lines: PriceLine[];
}

/**
 * Each area's services: the ones saved on the proposal when it was priced
 * this way, or else the ones the walkthrough suggests.
 */
export function forwardAreas(
  zones: WorkZone[],
  snapshot: ProposalZoneSnapshot[] | null,
  serviceName: (typeId: string) => string,
  pricing: PricingSetup = DEFAULT_SETUP
): ForwardArea[] {
  const priced = zones.filter((z) => z.service);
  const suggested = suggestJob(
    priced.map((z) => ({
      typeId: z.service!.typeId,
      serviceName: serviceName(z.service!.typeId),
      values: (z.service!.values ?? {}) as Record<string, unknown>,
      notes: z.service!.notes ?? null,
      areaSqFt: zoneMeasurements(z)?.areaSqFt ?? null,
    })),
    pricing.equation,
    pricing.services
  );
  const saved = snapshot && snapshot.length === priced.length && snapshot.every((s) => Array.isArray(s.lines)) ? snapshot : null;
  return priced.map((z, i) => ({
    notes: z.service!.notes?.trim() || null,
    photos: (z.service!.photos ?? []).map((path) => canvasImageUrl(path, PREVIEW)),
    lines: saved ? (saved[i].lines ?? []) : suggested[i],
  }));
}

/**
 * The walkthroughs waiting on the account manager: submitted and not
 * priced yet, then priced and not sent. For owners, admins and account
 * managers; null for anybody else.
 */
export async function getPriceApprovals(only?: { jobId?: string }): Promise<PriceApproval[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) return null;

  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  let query = supabase
    .from("job_proposals")
    .select(
      "job_id, status, total_cost, discount_amount, sent_at, token, generated_at, site_image_path, site_image_transform, scope_snapshot, job:jobs!inner(id, status, evaluation_submitted_at, referral_code, referred_by_profile_id, assignee:profiles!jobs_assigned_to_fkey(full_name, email), property:properties(address, lat, lng, customer:customers(name, email, account_manager_id)))"
    )
    .in("status", ["needs_approval", "sent"]);
  // One job, for its own pricing page.
  if (only?.jobId) query = query.eq("job_id", only.jobId);
  const { data, error } = await query.order("generated_at", { ascending: true }).limit(50);
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
      property: {
        address: string | null;
        lat: number | null;
        lng: number | null;
        customer: { name: string | null; email: string | null; account_manager_id: string | null } | null;
      } | null;
    };
  };
  // Waiting on a price, or priced lately and not sent to the client yet.
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.job.status !== "cancelled" && (r.status === "needs_approval" || (!r.sent_at && (r.generated_at ?? "") >= since))
  );
  if (rows.length === 0) return [];

  const jobIds = rows.map((r) => r.job_id);
  const [catalog, designs, fees, stock, pricing] = await Promise.all([
    getCanvasCatalog(),
    supabase.from("canvas_designs").select("job_id, zones").in("job_id", jobIds),
    feesForJobs(supabase, profile.organization_id, jobIds),
    supabase.from("materials").select("name, image_path, purchase_url").eq("organization_id", profile.organization_id),
    getProductionPricing(supabase, profile.organization_id),
  ]);
  const setup: PricingSetup = { equation: pricing.equation, services: pricing.services };
  // Each product by its name, with its photo and link, for the approval to show.
  const productBy = new Map(
    (stock.data ?? []).map((m) => [
      m.name.trim().toLowerCase(),
      {
        imageUrl: m.image_path ? `${env.supabaseUrl}/storage/v1/object/public/material-images/${m.image_path}` : null,
        url: m.purchase_url?.trim() || null,
      },
    ])
  );
  // The drive for each: shop, supplier, the house, back. Worked out the same
  // way the proposal was, so the costs here are the costs it was priced on.
  const travels = await Promise.all(
    rows.map((r) => {
      const at = r.job.property;
      return travelForProperty(supabase, profile.organization_id, at?.lat != null && at?.lng != null ? { lat: at.lat, lng: at.lng } : null).catch(() => ({
        toSiteMinutes: null,
        fromSiteMinutes: null,
        pickupExtraMinutes: null,
        from: null,
        pickupFrom: null,
        notes: ["Drive time could not be worked out."],
      }));
    })
  );
  const zonesByJob = new Map((designs.data ?? []).map((d) => [d.job_id as string, (d.zones ?? []) as unknown as WorkZone[]]));
  // Only a price still to accept is held up by wording.
  const toApprove = await wordingToApprove(
    rows.filter((r) => r.status === "needs_approval").map((r) => ({ jobId: r.job_id, zones: zonesByJob.get(r.job_id) ?? [] })),
    catalog.servicePricing
  ).catch(() => new Map<string, string[]>());
  const m = catalog.markup;
  const markup =
    m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0
      ? `× ${m.multiplier}, then + $${(m.overheadPerCrewHourCents / 100).toFixed(2)} a crew-hour overhead`
      : `× ${m.multiplier}, then + ${m.overheadPercent}% overhead`;

  return rows.map((r, index) => {
    const zones = (zonesByJob.get(r.job_id) ?? []).filter((z) => z.service);
    const breakdown = priceBreakdown(zones, catalog);
    const fee = fees.get(r.job_id)!;
    const costs = jobCosts(priceSiteMap({ zones, catalog, travel: travels[index], feePct: fee.pct }));
    return {
      jobId: r.job_id,
      client: r.job.property?.customer?.name || "Client",
      address: r.job.property?.address ?? "",
      email: r.job.property?.customer?.email?.trim() || null,
      evaluator: r.job.assignee?.full_name || r.job.assignee?.email || null,
      submittedAt: r.job.evaluation_submitted_at ?? r.generated_at,
      stage: r.status === "needs_approval" ? ("price" as const) : ("send" as const),
      wordingToApprove: toApprove.get(r.job_id) ?? [],
      reviewHref: `/jobs/${r.job_id}?open=proposal`,
      totalCents: Math.round((Number(r.total_cost ?? 0) - Number(r.discount_amount ?? 0)) * 100),
      // The client's own page, in preview: it shows before it is sent, with a
      // banner saying so, and the office opening it is not counted as the client.
      proposalHref: r.token ? `${proposalPath(r.token)}?preview=1` : null,
      breakdown,
      fee,
      costs,
      products: breakdown.materialTotals.map((m) => {
        const found = productBy.get(m.name.trim().toLowerCase());
        return { ...m, imageUrl: found?.imageUrl ?? null, url: found?.url ?? null, inInventory: Boolean(found) };
      }),
      crewRateCents: catalog.crewCostPerHourCents,
      markup,
      areaPhotos: breakdown.areas.map((a) => a.photoPaths.map((path) => canvasImageUrl(path, THUMBNAIL))),
      forward: zones.some((z) => isSalting(z.service!.typeId))
        ? null
        : forwardAreas(zones, r.scope_snapshot, (typeId) => catalog.servicePricing.find((p) => p.service_type_id === typeId)?.name ?? typeId, setup),
      pricing: setup,
      siteMap:
        r.site_image_path && r.site_image_transform
          ? { kind: "image" as const, imagePath: r.site_image_path, transform: r.site_image_transform, zones: r.scope_snapshot ?? [] }
          : null,
    };
  });
}
