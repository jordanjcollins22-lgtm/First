import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { loadAreaBoard } from "@/lib/data/area-board";
import { dateKeyIn, zonedToUtc } from "@/lib/time-zone";
import { projectStage, type ProjectStep } from "@/lib/projects-today";
import type { WorkZone } from "@/components/canvas/types";

/**
 * Projects today, for the account manager: every project with a visit today
 * on a client they manage (every project, for the owner), where it has got
 * to, anything wrong, and the crew's photos waiting on them.
 */

export interface PhotoToReview {
  id: string;
  url: string | null;
  kind: "Prep" | "After";
  zone: string | null;
  takenAt: string;
}

export interface ProjectToday {
  jobId: string;
  client: string;
  address: string;
  crew: string[];
  step: ProjectStep;
  now: string;
  since: string | null;
  areasDone: number;
  areasTotal: number;
  issues: string[];
  photos: PhotoToReview[];
}

type Row = {
  id: string;
  job_id: string;
  meet_on_site: boolean | null;
  jobs: {
    id: string;
    status: string;
    assigned_to: string | null;
    properties: { address: string; customers: { name: string; account_manager_id: string | null } | null } | null;
  } | null;
};

export async function getProjectsToday(viewer: { id: string; seesAll: boolean }): Promise<ProjectToday[]> {
  const supabase = await createClient();
  const day = dateKeyIn(new Date());
  const dayStart = zonedToUtc(day, "00:00").toISOString();

  const { data: sessionRows } = await supabase
    .from("job_work_sessions")
    .select("id, job_id, meet_on_site, jobs(id, status, assigned_to, properties(address, customers(name, account_manager_id)))")
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)")
    .is("subcontractor_id", null);
  const visits = ((sessionRows ?? []) as unknown as Row[]).filter(
    (r) =>
      r.jobs &&
      r.jobs.status !== "cancelled" &&
      (viewer.seesAll || r.jobs.properties?.customers?.account_manager_id === viewer.id)
  );
  // One card per project, even with two visits booked on it today.
  const byJob = new Map<string, Row>();
  for (const v of visits) if (!byJob.has(v.job_id)) byJob.set(v.job_id, v);
  const jobIds = [...byJob.keys()];
  if (jobIds.length === 0) return [];

  const [{ data: crewRows }, { data: shopDay }, { data: designs }, { data: photoRows }, { data: walkRows }, { data: issueRows }, { data: markRows }, { data: areaRows }, { data: stepRows }, catalog] =
    await Promise.all([
      supabase.from("job_crew").select("job_id, profile_id, profiles:profile_id(full_name, email)").in("job_id", jobIds),
      supabase.from("crew_shop_days").select("clocked_in_at, loadout_done_at, en_route_at").eq("day", day).maybeSingle(),
      supabase.from("canvas_designs").select("job_id, zones").in("job_id", jobIds),
      supabase.from("job_photos").select("id, job_id, path, kind, zone_id, zone_name, created_at, reviewed_at").in("job_id", jobIds),
      supabase.from("job_walkthroughs").select("job_id, requested_at, status").in("job_id", jobIds).eq("status", "requested"),
      supabase.from("job_issues").select("job_id, title, status").in("job_id", jobIds).not("status", "in", "(resolved,closed)"),
      supabase.from("job_photo_marks").select("photo_id, resolved_at").in("job_id", jobIds).is("resolved_at", null),
      supabase.from("job_area_work").select("job_id, started_at").in("job_id", jobIds).gte("started_at", dayStart),
      supabase.from("job_area_steps").select("job_id, done_at").in("job_id", jobIds).gte("done_at", dayStart),
      getCanvasCatalog(),
    ]);

  type CrewRow = { job_id: string; profile_id: string; profiles: { full_name: string | null; email: string } | null };
  const crew = (crewRows ?? []) as unknown as CrewRow[];
  const crewIds = [...new Set(crew.map((c) => c.profile_id))];
  const { data: eventRows } = crewIds.length
    ? await supabase.from("crew_day_events").select("profile_id, kind, job_id, at").eq("day", day).in("profile_id", crewIds).order("at", { ascending: true })
    : { data: [] };
  const events = (eventRows ?? []) as { profile_id: string; kind: string; job_id: string | null; at: string }[];

  const photos = (photoRows ?? []) as { id: string; job_id: string; path: string; kind: string; zone_id: string | null; zone_name: string | null; created_at: string; reviewed_at: string | null }[];
  const marked = new Set(((markRows ?? []) as { photo_id: string }[]).map((m) => m.photo_id));
  // Waiting on the account manager: a prep or after photo from today, not
  // looked at yet, and not already sent back.
  const toReview = photos.filter((p) => (p.kind === "during" || p.kind === "after") && !p.reviewed_at && p.created_at >= dayStart && !marked.has(p.id));
  const { data: signed } = toReview.length
    ? await supabase.storage.from("job-photos").createSignedUrls(toReview.map((p) => p.path), 60 * 60)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s, i) => [toReview[i].id, s.signedUrl ?? null]));

  const zonesOf = new Map(((designs ?? []) as { job_id: string; zones: unknown }[]).map((d) => [d.job_id, ((d.zones ?? []) as WorkZone[]).filter((z) => z.service)]));
  const shop = shopDay as { clocked_in_at: string | null; loadout_done_at: string | null; en_route_at: string | null } | null;

  const cards = await Promise.all(
    jobIds.map(async (jobId): Promise<ProjectToday> => {
      const visit = byJob.get(jobId)!;
      const job = visit.jobs!;
      const team = crew.filter((c) => c.job_id === jobId);
      const teamIds = new Set([...team.map((c) => c.profile_id), ...(job.assigned_to ? [job.assigned_to] : [])]);
      const theirs = events.filter((e) => teamIds.has(e.profile_id));
      const first = (kind: string, forJob = false) => theirs.find((e) => e.kind === kind && (!forJob || e.job_id === jobId))?.at ?? null;

      const zones = zonesOf.get(jobId) ?? [];
      const board = zones.length
        ? await loadAreaBoard(jobId, { zones, catalog, photos: photos.filter((p) => p.job_id === jobId).map((p) => ({ zone_id: p.zone_id, kind: p.kind })) }).catch(() => null)
        : null;
      const areas = zones.map((z) => {
        const state = board?.states.find((s) => s.zoneId === z.id);
        return {
          name: z.name,
          location: (z as unknown as { location?: string | null }).location?.trim() || null,
          prepped: Boolean(state?.prepped),
          done: state?.status === "done",
          working: state?.status === "working",
        };
      });

      // Work started in an area, a step ticked or a photo taken at the house
      // today: they are there, whether or not they tapped I've arrived.
      const workedAt = [
        ...((areaRows ?? []) as { job_id: string; started_at: string }[]).filter((r) => r.job_id === jobId).map((r) => r.started_at),
        ...((stepRows ?? []) as { job_id: string; done_at: string }[]).filter((r) => r.job_id === jobId).map((r) => r.done_at),
        ...photos.filter((p) => p.job_id === jobId && p.created_at >= dayStart && (p.kind === "during" || p.kind === "after")).map((p) => p.created_at),
      ].sort()[0] ?? null;

      const stage = projectStage({
        meetOnSite: Boolean(visit.meet_on_site),
        atShopAt: first("arrived_shop") ?? shop?.clocked_in_at ?? null,
        loadedAt: shop?.loadout_done_at ?? null,
        leftShopAt: first("left_shop") ?? shop?.en_route_at ?? null,
        arrivedAt: first("arrived_job", true) ?? workedAt,
        areas,
        walkthroughAskedAt: ((walkRows ?? []) as { job_id: string; requested_at: string | null }[]).find((w) => w.job_id === jobId)?.requested_at ?? null,
      });

      return {
        jobId,
        client: job.properties?.customers?.name ?? "Client",
        address: job.properties?.address ?? "",
        crew: team.map((c) => (c.profiles?.full_name || c.profiles?.email || "Crew").split(" ")[0]),
        ...stage,
        issues: ((issueRows ?? []) as { job_id: string; title: string }[]).filter((i) => i.job_id === jobId).map((i) => i.title),
        photos: toReview
          .filter((p) => p.job_id === jobId)
          .map((p) => ({ id: p.id, url: urlOf.get(p.id) ?? null, kind: p.kind === "after" ? ("After" as const) : ("Prep" as const), zone: p.zone_name, takenAt: p.created_at })),
      };
    })
  );
  // What needs the account manager first: issues, then photos, then the rest by how far along.
  return cards.sort((a, b) => b.issues.length - a.issues.length || b.photos.length - a.photos.length || b.step - a.step);
}
