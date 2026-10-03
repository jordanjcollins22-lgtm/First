import { createClient } from "@/lib/supabase/server";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getProposalForJob } from "@/lib/data/proposals";
import { fetchForecasts, type DailyForecast } from "@/lib/weather";
import type { JobWithLocation } from "@/lib/data/jobs";

/**
 * Everything worth knowing about a job the crew is booked on, gathered in one
 * place so nobody has to open four screens the morning they're heading out.
 *
 * Built for scheduled jobs only — a job with no work day isn't something
 * anyone needs a briefing for yet.
 */
export interface JobBriefing {
  jobId: string;
  jobName: string;
  customerName: string;
  address: string;
  status: string;
  /** The day the crew is due, which is also the day the forecast is for. */
  workDate: string | null;
  startDate: string | null;
  endDate: string | null;

  siteMap: {
    /** Stored image of the property the estimate was drawn over. */
    imagePath: string | null;
    hasPropertyLine: boolean;
  } | null;

  proposal: {
    status: string;
    total: number | null;
    approvedAt: string | null;
    zoneCount: number;
  } | null;

  /** Counts rather than the messages themselves — the briefing says whether
   * there's a conversation to catch up on, and the job page has the thread. */
  messages: { client: number; internal: number };

  /** Forecast for this address on the work day, when it's inside the window
   * the weather service covers. */
  forecast: DailyForecast | null;
  forecastNote: string | null;
}

// One job's briefing is several queries; a whole season of them would be
// hundreds. The calendar only ever asks for the ones coming up.
const MAX_BRIEFINGS = 8;

function workDateFor(job: JobWithLocation): string | null {
  return job.project_start_date ?? job.project_end_date ?? null;
}

export async function getJobBriefings(jobs: JobWithLocation[]): Promise<JobBriefing[]> {
  const scheduled = jobs
    .filter((j) => j.status !== "completed" && j.status !== "cancelled")
    .filter((j) => workDateFor(j))
    .sort((a, b) => (workDateFor(a) ?? "").localeCompare(workDateFor(b) ?? ""))
    .slice(0, MAX_BRIEFINGS);

  if (scheduled.length === 0) return [];

  const supabase = await createClient();

  // One weather call for every address rather than one per job.
  let forecastsByJob = new Map<string, DailyForecast[]>();
  try {
    const points = scheduled.map((j) => ({
      id: j.id,
      name: j.property.address,
      lat: j.property.lat,
      lng: j.property.lng,
    }));
    const forecasts = await fetchForecasts(points);
    forecastsByJob = new Map(forecasts.map((f) => [f.id, f.days]));
  } catch {
    // Weather is a nicety here; the rest of the briefing still stands.
  }

  return Promise.all(
    scheduled.map(async (job): Promise<JobBriefing> => {
      const [design, proposal, clientCount, internalCount] = await Promise.all([
        getCanvasDesignForJob(job.id).catch(() => null),
        getProposalForJob(job.id).catch(() => null),
        supabase
          .from("job_messages")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .eq("channel", "client")
          .then((r) => r.count ?? 0),
        supabase
          .from("job_messages")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .eq("channel", "internal")
          .then((r) => r.count ?? 0),
      ]);

      const workDate = workDateFor(job);
      const days = forecastsByJob.get(job.id) ?? [];
      const forecast = workDate ? (days.find((d) => d.date === workDate) ?? null) : null;

      let forecastNote: string | null = null;
      if (!forecast) {
        forecastNote =
          days.length === 0
            ? "Forecast unavailable right now."
            : "That day is beyond the 7-day forecast.";
      }

      return {
        jobId: job.id,
        jobName: job.name,
        customerName: job.property.customer.name,
        address: job.property.address,
        status: job.status,
        workDate,
        startDate: job.project_start_date,
        endDate: job.project_end_date,
        siteMap: design
          ? {
              imagePath: design.image_path,
              hasPropertyLine: (design.property_line?.length ?? 0) > 0,
            }
          : null,
        proposal: proposal
          ? {
              status: proposal.status,
              total: proposal.total_cost,
              approvedAt: proposal.approved_at,
              zoneCount: proposal.scope_snapshot?.length ?? 0,
            }
          : null,
        messages: { client: clientCount, internal: internalCount },
        forecast,
        forecastNote,
      };
    })
  );
}
