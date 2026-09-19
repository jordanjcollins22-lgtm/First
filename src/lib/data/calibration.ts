import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { zoneCrewHours } from "@/lib/proposal-pricing";
import { calibrateAll, headline, type ServiceCalibration, type WorkSample } from "@/lib/calibration";
import type { WorkZone } from "@/components/canvas/types";

/**
 * Quoted hours against clocked hours, per service.
 *
 * The quoted side comes from `zoneCrewHours` -- the same function that priced
 * the job -- so the comparison is against what the client was actually charged
 * for rather than a second estimate made for this screen. The clocked side is
 * `time_entries`, summed over everybody who was on the job, which is the same
 * crew-hours unit.
 *
 * A job counts only when it is finished and somebody actually clocked on and
 * off it. Half a job or a job nobody clocked is not evidence, and including it
 * would make every service look faster than it is.
 */

export interface CalibrationReport {
  services: ServiceCalibration[];
  headline: string;
  crewCostPerHourCents: number | null;
  /** Finished jobs that had no clocked time at all, so could say nothing. */
  jobsWithoutTime: number;
}

export async function calibrationReport(days = 540): Promise<CalibrationReport> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [jobRows, orgRow] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, completed_at, status")
      .eq("status", "completed")
      .gte("completed_at", since)
      .limit(1000)
      .then((r) => r.data ?? []),
    supabase.from("organizations").select("crew_cost_per_hour").eq("id", org).maybeSingle().then((r) => r.data),
  ]);

  const jobs = jobRows as unknown as { id: string; completed_at: string | null }[];
  const jobIds = jobs.map((j) => j.id);
  if (jobIds.length === 0) {
    return {
      services: [],
      headline: "No finished jobs yet, so there is nothing to compare a quote against.",
      crewCostPerHourCents: null,
      jobsWithoutTime: 0,
    };
  }

  const [catalog, designRows, timeRows] = await Promise.all([
    getCanvasCatalog(),
    supabase.from("canvas_designs").select("job_id, zones").in("job_id", jobIds).then((r) => r.data ?? []),
    supabase
      .from("time_entries")
      .select("job_id, clocked_in_at, clocked_out_at")
      .in("job_id", jobIds)
      .not("clocked_out_at", "is", null)
      .then((r) => r.data ?? []),
  ]);

  // Crew-hours clocked, summed over everybody. An entry still open counts for
  // nothing: a shift nobody closed is not a measured duration.
  const clockedByJob = new Map<string, number>();
  for (const row of timeRows as unknown as { job_id: string | null; clocked_in_at: string; clocked_out_at: string }[]) {
    if (!row.job_id) continue;
    const hours = (Date.parse(row.clocked_out_at) - Date.parse(row.clocked_in_at)) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    clockedByJob.set(row.job_id, (clockedByJob.get(row.job_id) ?? 0) + hours);
  }

  const samples: WorkSample[] = [];
  let jobsWithoutTime = 0;

  for (const design of designRows as unknown as { job_id: string; zones: WorkZone[] | null }[]) {
    const actualTotal = clockedByJob.get(design.job_id);
    if (!actualTotal) {
      jobsWithoutTime += 1;
      continue;
    }
    const zones = design.zones ?? [];
    const quotedByService = new Map<string, number>();
    let quotedTotal = 0;
    for (const zone of zones) {
      const typeId = zone.service?.typeId;
      if (!typeId) continue;
      const time = zoneCrewHours(zone, catalog);
      if (time.missingTiming || time.hours <= 0) continue;
      quotedByService.set(typeId, (quotedByService.get(typeId) ?? 0) + time.hours);
      quotedTotal += time.hours;
    }
    if (quotedTotal <= 0) continue;

    // A job with three services gets its clocked hours split between them in
    // proportion to what each was quoted at. It is the only split available --
    // nobody clocks on per service -- and it is stated here rather than
    // presented as a measurement of one service on its own.
    const completedAt = jobs.find((j) => j.id === design.job_id)?.completed_at ?? "";
    for (const [serviceTypeId, quotedHours] of quotedByService) {
      samples.push({
        jobId: design.job_id,
        serviceTypeId,
        quotedHours,
        actualHours: actualTotal * (quotedHours / quotedTotal),
        completedAt,
      });
    }
  }

  const crewCostPerHourCents =
    orgRow?.crew_cost_per_hour == null ? null : Math.round(Number(orgRow.crew_cost_per_hour) * 100);
  const services = calibrateAll(samples);

  return {
    services,
    headline: headline(services, crewCostPerHourCents),
    crewCostPerHourCents,
    jobsWithoutTime,
  };
}
