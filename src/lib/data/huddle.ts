import type { SupabaseClient } from "@supabase/supabase-js";

import { crewsFromSchedule, defaultGoal, readCrews, type Huddle, type ScheduleRow } from "@/lib/huddle";
import { createClient } from "@/lib/supabase/server";

/**
 * One day's team huddle. The crews come from the plan saved for the day when
 * there is one (the morning crew texts are written from it), otherwise from
 * the app's schedule: every visit covering the day, grouped by the job's lead.
 */
export async function loadHuddle(organizationId: string, day: string): Promise<Huddle> {
  // crew_huddles is not in the generated types yet.
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: row } = await sb
    .from("crew_huddles")
    .select("goal, crews, watch_outs, blockers, shout_out")
    .eq("organization_id", organizationId)
    .eq("day", day)
    .maybeSingle();

  let crews = readCrews(row?.crews);
  let source: Huddle["source"] = crews.length ? "plan" : "empty";
  if (!crews.length) {
    crews = crewsFromSchedule(await scheduleFor(sb, day));
    if (crews.length) source = "schedule";
  }

  return {
    day,
    goal: (row?.goal as string | null)?.trim() || defaultGoal(crews),
    crews,
    watchOuts: (row?.watch_outs as string | null) ?? "",
    blockers: (row?.blockers as string | null) ?? "",
    shoutOut: (row?.shout_out as string | null) ?? "",
    source,
  };
}

async function scheduleFor(sb: SupabaseClient, day: string): Promise<ScheduleRow[]> {
  const { data: sessions } = await sb
    .from("job_work_sessions")
    .select("job_id, purpose, stop_order, jobs(status, properties(address, customers(name)))")
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)")
    .is("subcontractor_id", null);

  type Row = {
    job_id: string;
    purpose: string | null;
    stop_order: number | null;
    jobs: { status: string; properties: { address: string; customers: { name: string } | null } | null } | null;
  };
  const rows = ((sessions ?? []) as unknown as Row[]).filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed");
  if (!rows.length) return [];

  const { data: leads } = await sb
    .from("job_crew")
    .select("job_id, profiles(full_name, first_name)")
    .eq("is_lead", true)
    .in("job_id", [...new Set(rows.map((r) => r.job_id))]);
  const leadOf = new Map<string, string>();
  for (const l of (leads ?? []) as unknown as { job_id: string; profiles: { full_name: string | null; first_name: string | null } | null }[]) {
    const name = l.profiles?.first_name || l.profiles?.full_name;
    if (name) leadOf.set(l.job_id, name);
  }

  return rows.map((r) => ({
    jobId: r.job_id,
    client: r.jobs?.properties?.customers?.name ?? "Client",
    address: r.jobs?.properties?.address ?? "",
    purpose: r.purpose,
    stopOrder: r.stop_order,
    lead: leadOf.get(r.job_id) ?? null,
  }));
}
