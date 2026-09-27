import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { isAccountManager } from "@/lib/affiliate-roles";
import { isOwnerLevel } from "@/lib/roles";
import { proposalPath } from "@/lib/proposal-flow";
import { priceBreakdown, type PriceBreakdown } from "@/lib/price-approval";
import type { WorkZone } from "@/components/canvas/types";

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
  crewRateCents: number;
  markup: string;
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
      "job_id, status, total_cost, discount_amount, sent_at, token, generated_at, job:jobs!inner(id, status, evaluation_submitted_at, assignee:profiles!jobs_assigned_to_fkey(full_name, email), property:properties(address, customer:customers(name, email)))"
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
    job: {
      id: string;
      status: string;
      evaluation_submitted_at: string | null;
      assignee: { full_name: string | null; email: string | null } | null;
      property: { address: string | null; customer: { name: string | null; email: string | null } | null } | null;
    };
  };
  // Waiting on a price, or priced lately and not sent to the client yet.
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.job.status !== "cancelled" && (r.status === "needs_approval" || (!r.sent_at && (r.generated_at ?? "") >= since))
  );
  if (rows.length === 0) return [];

  const [catalog, designs] = await Promise.all([
    getCanvasCatalog(),
    supabase.from("canvas_designs").select("job_id, zones").in("job_id", rows.map((r) => r.job_id)),
  ]);
  const zonesByJob = new Map((designs.data ?? []).map((d) => [d.job_id as string, (d.zones ?? []) as unknown as WorkZone[]]));
  const m = catalog.markup;
  const markup =
    m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0
      ? `× ${m.multiplier}, then + $${(m.overheadPerCrewHourCents / 100).toFixed(2)} a crew-hour overhead`
      : `× ${m.multiplier}, then + ${m.overheadPercent}% overhead`;

  return rows.map((r) => ({
    jobId: r.job_id,
    client: r.job.property?.customer?.name || "Client",
    address: r.job.property?.address ?? "",
    email: r.job.property?.customer?.email?.trim() || null,
    evaluator: r.job.assignee?.full_name || r.job.assignee?.email || null,
    submittedAt: r.job.evaluation_submitted_at ?? r.generated_at,
    stage: r.status === "needs_approval" ? "price" : "send",
    totalCents: Math.round((Number(r.total_cost ?? 0) - Number(r.discount_amount ?? 0)) * 100),
    proposalHref: r.token ? proposalPath(r.token) : null,
    breakdown: priceBreakdown(zonesByJob.get(r.job_id) ?? [], catalog),
    crewRateCents: catalog.crewCostPerHourCents,
    markup,
  }));
}
