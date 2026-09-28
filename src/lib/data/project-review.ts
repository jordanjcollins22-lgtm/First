import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { feesForJobs } from "@/lib/data/job-fee";
import { travelForProperty } from "@/lib/data/job-travel";
import { priceSiteMap, jobCosts } from "@/lib/job-price";
import type { JobEstimate } from "@/lib/job-estimate";
import type { JobFee } from "@/lib/gross-profit";
import type { WorkZone } from "@/components/canvas/types";
import { budgetFromEstimate, scoreProject, type ProjectReview, type ProjectReviewInput, type ReviewIssue } from "@/lib/project-review";

/**
 * The project review, read from what the job has on it now: the proposal's
 * price and the estimate it was priced on, every clocked hour, every
 * receipt, every issue and crew ticket, a five-star review found or marked,
 * and the clients they sent to us. Nothing is stored; it is worked out every
 * time the page is opened, so it is always current.
 */

export interface ProjectReviewRow {
  jobId: string;
  client: string;
  customerId: string | null;
  address: string;
  status: string;
  priceCents: number;
  fee: JobFee;
  review: ProjectReview;
  issues: ReviewIssue[];
  /** The proposal has not been said yes to yet: the review is what it would start from. */
  preview: boolean;
  fiveStarMarked: boolean | null;
}

const CLOSED = new Set(["resolved", "closed", "done"]);

/** First name and last initial, lower case: "marilyn g". */
function nameKey(name: string | null | undefined): string | null {
  const words = (name ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return `${words[0]} ${words[words.length - 1][0]}`;
}

export async function getProjectReviews(jobIds: string[]): Promise<ProjectReviewRow[]> {
  if (jobIds.length === 0) return [];
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const [jobsRes, proposalsRes, timeRes, receiptsRes, issuesRes, ticketsRes, catalog, fees, proofRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, created_at, five_star_review, property:properties(address, lat, lng, customer:customers(id, name))")
      .in("id", jobIds),
    supabase.from("job_proposals").select("job_id, status, total_cost, discount_amount, estimate").in("job_id", jobIds),
    supabase.from("time_entries").select("job_id, clocked_in_at, clocked_out_at").in("job_id", jobIds),
    supabase.from("job_receipts").select("job_id, amount_cents").in("job_id", jobIds),
    supabase.from("job_issues").select("id, job_id, title, status, resolution, prevention, created_at").in("job_id", jobIds),
    supabase.from("job_tickets").select("id, job_id, title, status, resolution, prevention, created_at").in("job_id", jobIds),
    getCanvasCatalog(),
    feesForJobs(supabase, organizationId, jobIds),
    supabase.from("booking_proof").select("author, stars, written_on, source").eq("organization_id", organizationId).eq("stars", 5),
  ]);

  type JobRow = {
    id: string;
    status: string;
    created_at: string;
    five_star_review: boolean | null;
    property: { address: string | null; lat: number | null; lng: number | null; customer: { id: string; name: string | null } | null } | null;
  };
  const jobs = (jobsRes.data ?? []) as unknown as JobRow[];
  const customerIds = jobs.map((j) => j.property?.customer?.id).filter((id): id is string => Boolean(id));
  const { data: referred } = customerIds.length
    ? await supabase.from("customers").select("name, referred_by_customer_id").in("referred_by_customer_id", customerIds)
    : { data: [] as { name: string; referred_by_customer_id: string | null }[] };

  const proposalBy = new Map((proposalsRes.data ?? []).map((p) => [p.job_id as string, p]));
  const now = Date.now();
  const hoursBy = new Map<string, number>();
  for (const t of timeRes.data ?? []) {
    const end = t.clocked_out_at ? new Date(t.clocked_out_at).getTime() : now;
    const h = Math.max(0, end - new Date(t.clocked_in_at).getTime()) / 3_600_000;
    hoursBy.set(t.job_id as string, (hoursBy.get(t.job_id as string) ?? 0) + h);
  }
  const receiptsBy = new Map<string, number>();
  for (const r of receiptsRes.data ?? []) receiptsBy.set(r.job_id, (receiptsBy.get(r.job_id) ?? 0) + (r.amount_cents ?? 0));
  const issuesBy = new Map<string, ReviewIssue[]>();
  for (const [kind, rows] of [
    ["issue", issuesRes.data ?? []],
    ["ticket", ticketsRes.data ?? []],
  ] as const) {
    for (const row of rows as { id: string; job_id: string; title: string; status: string; resolution: string | null; prevention: string | null; created_at: string }[]) {
      const list = issuesBy.get(row.job_id) ?? [];
      list.push({
        id: row.id,
        kind,
        title: row.title,
        open: !CLOSED.has(row.status),
        resolution: row.resolution,
        prevention: row.prevention,
        createdAt: row.created_at,
      });
      issuesBy.set(row.job_id, list);
    }
  }
  const proofs = (proofRes.data ?? []) as { author: string | null; written_on: string | null; source: string | null }[];

  // An estimate from before hours were charged whole is worked out afresh,
  // the same way the approval card does.
  const designs = new Map<string, WorkZone[]>();
  const stale = jobs.filter((j) => !budgetFromEstimate(proposalBy.get(j.id)?.estimate as unknown as JobEstimate | null)).map((j) => j.id);
  if (stale.length > 0) {
    const { data } = await supabase.from("canvas_designs").select("job_id, zones").in("job_id", stale);
    for (const d of data ?? []) designs.set(d.job_id as string, ((d.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service));
  }

  return Promise.all(
    jobs.map(async (job): Promise<ProjectReviewRow> => {
      const proposal = proposalBy.get(job.id);
      const priceCents = Math.round((Number(proposal?.total_cost ?? 0) - Number(proposal?.discount_amount ?? 0)) * 100);
      const fee = fees.get(job.id)!;
      let budget = budgetFromEstimate(proposal?.estimate as unknown as JobEstimate | null);
      const zones = designs.get(job.id);
      if (!budget && zones && zones.length > 0) {
        const at = job.property;
        const travel = await travelForProperty(supabase, organizationId, at?.lat != null && at?.lng != null ? { lat: at.lat, lng: at.lng } : null).catch(() => ({
          toSiteMinutes: null,
          fromSiteMinutes: null,
          pickupExtraMinutes: null,
          from: null,
          pickupFrom: null,
          notes: [],
        }));
        const priced = priceSiteMap({ zones, catalog, travel, feePct: fee.pct });
        const costs = jobCosts(priced);
        const e = priced.estimate;
        const saltHours = priced.salting.reduce((sum, s) => sum + (s ? s.billedHours * s.treatments : 0), 0);
        budget = {
          crewHours: (e.zones.length > 0 ? (e.billedHours ?? 0) * e.crew : 0) + saltHours,
          labourCents: costs.labourCents,
          materialsCents: costs.materialsCents,
        };
      }

      const customer = job.property?.customer ?? null;
      const key = nameKey(customer?.name);
      const found = key ? proofs.find((p) => nameKey(p.author) === key && (!p.written_on || p.written_on >= job.created_at.slice(0, 10))) : undefined;
      const fiveStar: ProjectReviewInput["fiveStar"] =
        job.five_star_review != null
          ? { value: job.five_star_review, how: "marked", note: job.five_star_review ? "Marked by hand" : "Marked: no review" }
          : found
            ? { value: true, how: "found", note: `Found: ${found.author}${found.source ? ` on ${found.source}` : ""}` }
            : { value: null, how: null, note: null };

      const issues = (issuesBy.get(job.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const review = scoreProject({
        priceCents,
        budget,
        realCrewHours: hoursBy.get(job.id) ?? 0,
        crewRateCents: catalog.crewCostPerHourCents,
        receiptsCents: receiptsBy.get(job.id) ?? 0,
        feePct: fee.pct,
        issues,
        fiveStar,
        referred: (referred ?? []).filter((c) => c.referred_by_customer_id === customer?.id).map((c) => c.name),
      });
      return {
        jobId: job.id,
        client: customer?.name ?? "Client",
        customerId: customer?.id ?? null,
        address: job.property?.address ?? "",
        status: job.status,
        priceCents,
        fee,
        review,
        issues,
        preview: proposal?.status !== "accepted",
        fiveStarMarked: job.five_star_review,
      };
    })
  );
}

/** One job's review, for its own page. Null when it has no proposal yet. */
export async function getProjectReview(jobId: string): Promise<ProjectReviewRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_proposals").select("job_id").eq("job_id", jobId).maybeSingle();
  if (!data) return null;
  return (await getProjectReviews([jobId]))[0] ?? null;
}

/** Every project a client said yes to, newest first, for the board. */
export async function listProjectReviews(): Promise<ProjectReviewRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_proposals")
    .select("job_id, approved_at, job:jobs!inner(status)")
    .eq("status", "accepted")
    .order("approved_at", { ascending: false })
    .limit(100);
  const ids = ((data ?? []) as unknown as { job_id: string; job: { status: string } }[]).filter((p) => p.job.status !== "cancelled").map((p) => p.job_id);
  const rows = await getProjectReviews(ids);
  return ids.map((id) => rows.find((r) => r.jobId === id)).filter((r): r is ProjectReviewRow => Boolean(r));
}
