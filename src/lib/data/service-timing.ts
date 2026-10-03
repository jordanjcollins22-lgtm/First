import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalZoneSnapshot } from "@/types/domain";
import { suggestJob, type ProductionUnit } from "@/lib/forward-pricing";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { zoneMeasurements } from "@/lib/proposal-pricing";
import { servicesToTime, type ServiceTimeLog, type TimedService } from "@/lib/service-timing";

type Client = SupabaseClient<Database>;

export interface JobServiceTimers {
  services: TimedService[];
  /** This job's timers, running and finished. */
  logs: ServiceTimeLog[];
  /** People on a standard crew, the starting answer for how many were on it. */
  crewPeople: number;
}

type LogRow = {
  id: string;
  job_id: string;
  zone_id: string;
  zone_name: string;
  service_key: string;
  unit: string;
  quantity: number | null;
  people: number | null;
  started_at: string;
  finished_at: string | null;
  excluded: boolean;
  starter?: { full_name: string | null; email: string } | null;
  job?: { job_number: number | null; property: { address: string | null } | null } | null;
};

const LOG_COLUMNS = "id, job_id, zone_id, zone_name, service_key, unit, quantity, people, started_at, finished_at, excluded, starter:profiles!service_time_logs_started_by_fkey(full_name, email)";

function toLog(r: LogRow): ServiceTimeLog {
  return {
    id: r.id,
    jobId: r.job_id,
    jobNumber: r.job?.job_number ?? null,
    where: r.job?.property?.address ?? null,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    serviceKey: r.service_key,
    unit: r.unit as ProductionUnit,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    people: r.people,
    excluded: r.excluded,
    by: (r.starter?.full_name || r.starter?.email || "").split(/\s+/)[0] || null,
  };
}

/**
 * What the crew can time on one job: every priced service on every area, as
 * the proposal was approved with them (or, for a proposal priced before
 * services were, the ones the walkthrough suggests), and the timers already
 * started. Null when the timers aren't there yet (migration 0337).
 */
export async function loadJobServiceTimers(
  supabase: Client,
  jobId: string,
  organizationId: string,
  zones: WorkZone[],
  serviceName: (typeId: string) => string
): Promise<JobServiceTimers | null> {
  const priced = zones.filter((z) => z.service);
  const [{ data: proposal }, pricing, logs] = await Promise.all([
    supabase.from("job_proposals").select("scope_snapshot").eq("job_id", jobId).maybeSingle(),
    getProductionPricing(supabase, organizationId),
    supabase.from("service_time_logs").select(LOG_COLUMNS).eq("job_id", jobId).order("started_at", { ascending: true }),
  ]);
  if (logs.error) {
    if (!/service_time_logs/.test(logs.error.message ?? "") && logs.error.code !== "42P01" && logs.error.code !== "PGRST205") console.error("[service-timing] read failed:", logs.error.message);
    return null;
  }
  const snapshot = ((proposal?.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[]) ?? [];
  const saved = snapshot.length === priced.length && snapshot.every((s) => Array.isArray(s.lines));
  const lines = saved
    ? snapshot.map((s) => s.lines ?? [])
    : suggestJob(
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
  return {
    services: servicesToTime(
      priced.map((z, i) => ({ zoneId: z.id, zoneName: z.name, lines: lines[i] ?? [] })),
      pricing.services
    ),
    logs: ((logs.data ?? []) as unknown as LogRow[]).map(toLog),
    crewPeople: pricing.equation.leads + pricing.equation.technicians,
  };
}

/** Every finished timer in the business, newest first, with its job, for the averages. */
export async function listServiceTimeLogs(supabase: Client, organizationId: string): Promise<{ logs: ServiceTimeLog[]; available: boolean }> {
  const { data, error } = await supabase
    .from("service_time_logs")
    .select(`${LOG_COLUMNS}, job:jobs(job_number, property:properties(address))`)
    .eq("organization_id", organizationId)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(2000);
  if (error) return { logs: [], available: false };
  return { logs: ((data ?? []) as unknown as LogRow[]).map(toLog), available: true };
}
