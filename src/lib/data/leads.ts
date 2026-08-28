import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import {
  assessLead,
  calibrateFromHistory,
  REASON_LABELS,
  TARGET_TICKET,
  type LeadReason,
  type TicketCalibration,
} from "@/lib/leads";
import { checkHarford } from "@/lib/harford";

export interface LeadRow {
  jobId: string;
  contactName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  reason: LeadReason;
  reasonLabel: string;
  ticket: number | null;
  ticketIsEstimate: boolean;
  qualifies: boolean;
  score: number;
  why: string[];
  acreage: number | null;
}

/** How a channel is actually performing against the $5k target. */
export interface SourcePerformance {
  source: string;
  jobs: number;
  won: number;
  /** Average of the proposals that closed. */
  averageTicket: number | null;
  /** Won jobs at or above the target. */
  bigJobs: number;
}

/** Where the work is, grouped by the town in the address. */
export interface AreaPerformance {
  area: string;
  jobs: number;
  averageTicket: number | null;
  bigJobs: number;
}

export interface LeadEngineData {
  calibration: TicketCalibration;
  leads: LeadRow[];
  sources: SourcePerformance[];
  areas: AreaPerformance[];
  /** Won work at or above the target, over all time. */
  qualifiedWon: number;
  averageWonTicket: number | null;
  /**
   * Leads whose address is definitely not in Harford County.
   *
   * Almost always a bad address rather than a customer three states away: a
   * geocoder that guessed, or a town name that exists everywhere. They look
   * real in the list, and somebody eventually drives to one.
   */
  outOfArea: OutOfAreaLead[];
}

export interface OutOfAreaLead {
  jobId: string;
  contactName: string;
  address: string;
  /** What gave it away, so it can be judged without opening the job. */
  reason: string;
}

/** Best-effort town from a free-text address: the part before the state. */
function areaFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[parts.length - 2] || "Unknown";
  return "Unknown";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export async function getLeadEngine(): Promise<LeadEngineData> {
  const jobs = await listJobsWithLocation();
  if (jobs.length === 0) {
    return {
      calibration: calibrateFromHistory([]),
      leads: [],
      sources: [],
      areas: [],
      qualifiedWon: 0,
      averageWonTicket: null,
      outOfArea: [],
    };
  }

  const supabase = await createClient();

  const [{ data: proposals }, { data: waves }] = await Promise.all([
    supabase
      .from("job_proposals")
      .select("job_id, status, total_cost, approved_at")
      .in(
        "job_id",
        jobs.map((j) => j.id)
      ),
    supabase.from("attractor_waves").select("id, name"),
  ]);

  const proposalByJob = new Map(
    ((proposals ?? []) as { job_id: string; status: string; total_cost: number | null; approved_at: string | null }[]).map(
      (p) => [p.job_id, p]
    )
  );
  const waveNames = new Map(((waves ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  // Calibrate the ticket estimate on work that actually closed, so the numbers
  // reflect this business rather than an industry average.
  const closed = jobs
    .map((job) => {
      const proposal = proposalByJob.get(job.id);
      const won = job.status === "completed" || proposal?.status === "accepted";
      if (!won || !proposal?.total_cost) return null;
      return { acreage: job.property.acreage ?? null, total: Number(proposal.total_cost) };
    })
    .filter((s): s is { acreage: number | null; total: number } => s !== null);

  const calibration = calibrateFromHistory(closed);

  const leads: LeadRow[] = [];
  for (const job of jobs) {
    const proposal = proposalByJob.get(job.id) ?? null;
    const assessment = assessLead(
      {
        jobStatus: job.status,
        proposalStatus: proposal?.status ?? null,
        proposalTotal: proposal?.total_cost != null ? Number(proposal.total_cost) : null,
        evaluationStatus: job.evaluation_status,
        evaluationDate: job.evaluation_date,
        lastActivity: proposal?.approved_at ?? job.evaluation_date ?? job.updated_at,
        acreage: job.property.acreage ?? null,
      },
      calibration
    );

    if (!assessment.reason) continue;

    leads.push({
      jobId: job.id,
      contactName: job.property.customer.name,
      address: job.property.address,
      lat: job.property.lat ?? null,
      lng: job.property.lng ?? null,
      reason: assessment.reason,
      reasonLabel: REASON_LABELS[assessment.reason],
      ticket: assessment.ticket,
      ticketIsEstimate: assessment.ticketIsEstimate,
      qualifies: assessment.qualifies,
      score: assessment.score,
      why: assessment.why,
      acreage: job.property.acreage ?? null,
    });
  }

  leads.sort((a, b) => b.score - a.score);

  // Where the money actually comes from.
  const sourceBuckets = new Map<string, { jobs: number; wonTotals: number[] }>();
  const areaBuckets = new Map<string, { jobs: number; wonTotals: number[] }>();

  for (const job of jobs) {
    const proposal = proposalByJob.get(job.id);
    const won = job.status === "completed" || proposal?.status === "accepted";
    const total = proposal?.total_cost != null ? Number(proposal.total_cost) : null;

    const source = job.source_attractor_wave_id
      ? (waveNames.get(job.source_attractor_wave_id) ?? "Marketing wave")
      : job.referred_by_profile_id
        ? "Affiliate link"
        : "Direct / walk-in";

    const sourceBucket = sourceBuckets.get(source) ?? { jobs: 0, wonTotals: [] };
    sourceBucket.jobs += 1;
    if (won && total) sourceBucket.wonTotals.push(total);
    sourceBuckets.set(source, sourceBucket);

    const area = areaFromAddress(job.property.address);
    const areaBucket = areaBuckets.get(area) ?? { jobs: 0, wonTotals: [] };
    areaBucket.jobs += 1;
    if (won && total) areaBucket.wonTotals.push(total);
    areaBuckets.set(area, areaBucket);
  }

  const sources: SourcePerformance[] = [...sourceBuckets.entries()]
    .map(([source, b]) => ({
      source,
      jobs: b.jobs,
      won: b.wonTotals.length,
      averageTicket: average(b.wonTotals),
      bigJobs: b.wonTotals.filter((t) => t >= TARGET_TICKET).length,
    }))
    .sort((a, b) => b.bigJobs - a.bigJobs || b.jobs - a.jobs);

  const areas: AreaPerformance[] = [...areaBuckets.entries()]
    .map(([area, b]) => ({
      area,
      jobs: b.jobs,
      averageTicket: average(b.wonTotals),
      bigJobs: b.wonTotals.filter((t) => t >= TARGET_TICKET).length,
    }))
    .sort((a, b) => b.bigJobs - a.bigJobs || b.jobs - a.jobs);

  const allWon = [...sourceBuckets.values()].flatMap((b) => b.wonTotals);

  // Only the ones a check can be sure about. An address it cannot read is
  // not evidence of anything, and a list of two hundred fine addresses is a
  // list nobody opens.
  const outOfArea: OutOfAreaLead[] = [];
  for (const lead of leads) {
    const check = checkHarford({ address: lead.address, lat: lead.lat, lng: lead.lng });
    if (check.verdict !== "outside") continue;
    outOfArea.push({
      jobId: lead.jobId,
      contactName: lead.contactName,
      address: lead.address,
      reason: check.reason,
    });
  }

  return {
    calibration,
    leads,
    sources,
    areas,
    qualifiedWon: allWon.filter((t) => t >= TARGET_TICKET).length,
    averageWonTicket: average(allWon),
    outOfArea,
  };
}
