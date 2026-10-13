import { admin } from "@/lib/data/ops-settings";
import { loadCrewBudgets } from "@/lib/data/ops-panels";
import { listJobExceptions } from "@/lib/data/exceptions";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { getDayLoadout, getShopDay } from "@/lib/data/shop-flow";
import { createClient } from "@/lib/supabase/server";
import { crewMemberStatus, sortCrew, type CrewStatus } from "@/lib/lead-day";
import { KIND_LABEL } from "@/lib/exceptions";
import { canRequestWalkthrough, currentWalkthrough } from "@/lib/walkthrough";
import { workHasStarted } from "@/lib/job-stage";
import { canRunJobs } from "@/lib/roles";
import type { CrewDayData } from "@/lib/data/crew-day";
import type { CrewEvent, CrewEventKind } from "@/lib/crew-day";
import type { Loadout } from "@/lib/loadout";
import type { BudgetMeter } from "@/lib/ops/job-cost";
import type { JobStatus, Profile, WalkthroughStatus } from "@/types/domain";

export interface LeadCrewMember {
  profileId: string;
  name: string;
  phone: string | null;
  status: CrewStatus;
}

export interface LeadJob {
  jobId: string;
  sessionId: string;
  customerName: string;
  address: string;
  budget: BudgetMeter | null;
  /** Open reports from the field on this job. */
  issues: { id: string; label: string; summary: string; blocksWork: boolean; acknowledged: boolean }[];
  walk: { status: WalkthroughStatus; reviewNotes: string | null } | null;
  /** Whether the walk can be asked for now, and why not when it can't. */
  canAskWalk: { ok: boolean; reason: string | null };
  completed: boolean;
}

export interface LeadMaterial {
  key: string;
  label: string;
  forStops: string[];
  checked: boolean;
}

export interface LeadDay {
  crew: LeadCrewMember[];
  jobs: LeadJob[];
  materials: LeadMaterial[];
}

/**
 * Everything the project lead needs about their crew and their jobs today.
 *
 * Their jobs are the stops on their own day, so the screen is about the work
 * they are on and nothing else. The crew's taps are read past row security,
 * because a lead may only read their own: only for the people on the lead's
 * own jobs today, and only after checking the person asking runs jobs.
 */
export async function getLeadDay(profile: Profile, ctx: { day: CrewDayData; loadout: Loadout | null }, now: Date = new Date()): Promise<LeadDay> {
  const { day, loadout } = ctx;
  const stops = day.stops;
  if (!canRunJobs(profile.roles) || stops.length === 0) return { crew: [], jobs: [], materials: materialsFrom(loadout, null) };
  const jobIds = stops.map((s) => s.jobId);
  const db = admin();

  const [crew, budgets, jobRows, perJob, materials] = await Promise.all([
    (async (): Promise<LeadCrewMember[]> => {
      const [{ data: crewRows }, { data: org }] = await Promise.all([
        db.from("job_crew").select("job_id, profile_id, profiles!job_crew_profile_id_fkey(full_name, email, phone)").in("job_id", jobIds),
        db.from("organizations").select("shop_arrival_time").eq("id", profile.organization_id).maybeSingle(),
      ]);
      type Row = { job_id: string; profile_id: string; profiles: { full_name: string | null; email: string; phone: string | null } | null };
      const people = new Map<string, { name: string; phone: string | null; jobs: Set<string> }>();
      for (const r of (crewRows ?? []) as unknown as Row[]) {
        if (r.profile_id === profile.id) continue;
        const p = people.get(r.profile_id) ?? { name: r.profiles?.full_name || r.profiles?.email || "Someone", phone: r.profiles?.phone ?? null, jobs: new Set<string>() };
        p.jobs.add(r.job_id);
        people.set(r.profile_id, p);
      }
      if (people.size === 0) return [];
      const { data: eventRows } = await db
        .from("crew_day_events")
        .select("profile_id, kind, job_id, at")
        .eq("organization_id", profile.organization_id)
        .eq("day", day.day)
        .in("profile_id", [...people.keys()])
        .order("at", { ascending: true });
      const eventsBy = new Map<string, CrewEvent[]>();
      for (const e of (eventRows ?? []) as { profile_id: string; kind: string; job_id: string | null; at: string }[]) {
        const list = eventsBy.get(e.profile_id) ?? [];
        list.push({ kind: e.kind as CrewEventKind, jobId: e.job_id, at: e.at });
        eventsBy.set(e.profile_id, list);
      }
      const arriveBy = ((org as { shop_arrival_time?: string | null } | null)?.shop_arrival_time ?? null) || null;
      return sortCrew(
        [...people.entries()].map(([profileId, p]) => ({
          profileId,
          name: p.name,
          phone: p.phone,
          status: crewMemberStatus({ events: eventsBy.get(profileId) ?? [], stops: stops.filter((s) => p.jobs.has(s.jobId)), arriveBy, now }),
        }))
      );
    })().catch(() => []),
    loadCrewBudgets(profile.organization_id, { now }).catch(() => []),
    (async () => {
      const { data } = await (await createClient()).from("jobs").select("id, status").in("id", jobIds);
      return new Map(((data ?? []) as { id: string; status: JobStatus }[]).map((j) => [j.id, j.status]));
    })().catch(() => new Map<string, JobStatus>()),
    Promise.all(
      jobIds.map(async (jobId) => {
        const [exceptions, schedule] = await Promise.all([listJobExceptions(jobId).catch(() => []), getJobSchedule(jobId)]);
        return { jobId, exceptions, schedule };
      })
    ),
    (async () => {
      const shopDay = await getShopDay(day.day).catch(() => null);
      const shared = shopDay ? await getDayLoadout(day.day, shopDay.checks).catch(() => null) : null;
      return materialsFrom(shared ?? loadout, shared ? new Set(stops.map((s) => s.customerName)) : null);
    })().catch(() => materialsFrom(loadout, null)),
  ]);

  const budgetBy = new Map(budgets.map((b) => [b.jobId, b.meter]));
  const jobs: LeadJob[] = stops.map((stop) => {
    const extra = perJob.find((p) => p.jobId === stop.jobId);
    const status = jobRows.get(stop.jobId) ?? "approved";
    const walks = extra?.schedule.walkthroughs ?? [];
    const current = currentWalkthrough(walks);
    // Arriving on the job is what starts the visit: the walk button sorts that out when pressed.
    const arrived = day.events.some((e) => e.kind === "arrived_job" && e.jobId === stop.jobId);
    const started =
      arrived ||
      workHasStarted({
        status,
        evaluationStatus: "",
        evaluationDate: null,
        proposalStatus: null,
        sessions: (extra?.schedule.sessions ?? []).map((s) => ({ status: s.status, startsOn: s.starts_on, endsOn: s.ends_on })),
        today: day.day,
      });
    const verdict = canRequestWalkthrough(started, walks);
    return {
      jobId: stop.jobId,
      sessionId: stop.sessionId,
      customerName: stop.customerName,
      address: stop.address,
      budget: budgetBy.get(stop.jobId) ?? null,
      issues: (extra?.exceptions ?? [])
        .filter((x) => x.state === "reported" || x.state === "acknowledged")
        .map((x) => ({ id: x.id, label: KIND_LABEL[x.kind] ?? x.kind, summary: x.summary, blocksWork: x.blocksWork, acknowledged: x.state === "acknowledged" })),
      walk: current ? { status: current.status, reviewNotes: current.review_notes } : null,
      canAskWalk: verdict.ok ? { ok: true, reason: null } : { ok: false, reason: verdict.reason },
      completed: status === "completed",
    };
  });

  return { crew, jobs, materials };
}

/** The materials on a load-out, for these clients only when it is the whole shop's. */
function materialsFrom(loadout: Loadout | null, forClients: Set<string> | null): LeadMaterial[] {
  return (loadout?.items ?? [])
    .filter((i) => i.kind === "material")
    .filter((i) => !forClients || i.forStops.some((c) => forClients.has(c)))
    .map((i) => ({ key: i.key, label: i.label, forStops: i.forStops, checked: i.checked }));
}
