import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/lib/data/team";
import {
  buildActivity,
  type ActivityItem,
  type CrewEventRow,
  type MilestoneRow,
  type SessionRow,
} from "@/lib/activity";

/** How many lines the feed shows. A day of taps from three crews is a few
 * hundred rows and nobody scrolls past the first screen of them. */
const LIMIT = 60;

/** A query whose table might not exist yet costs an empty list, not the page. */
async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * The day's activity, from every table that records somebody doing something.
 *
 * Every query is bounded by the window and capped, and the whole thing is
 * wrapped so a table that has not been migrated yet costs an empty feed rather
 * than a dashboard that will not load. The feed is the nice-to-have on that
 * page; the piles are the point.
 */
export async function getActivity(
  start: string,
  end: string,
): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const from = `${start}T00:00:00`;
  // Inclusive to the last millisecond of the last day, so a tap at 23:59 counts.
  const until = `${end}T23:59:59.999`;

  const [crewRes, sessionRes, walkRes, doneRes, profiles] = await Promise.all([
    safe(
      supabase
        .from("crew_day_events")
        .select("id, kind, at, profile_id, job_id, note")
        .gte("at", from)
        .lte("at", until)
        .order("at", { ascending: false })
        .limit(LIMIT),
    ),
    safe(
      supabase
        .from("job_work_sessions")
        .select("id, job_id, status, updated_at, pause_reason, purpose")
        .gte("updated_at", from)
        .lte("updated_at", until)
        .order("updated_at", { ascending: false })
        .limit(LIMIT),
    ),
    safe(
      supabase
        .from("job_walkthroughs")
        .select(
          "id, job_id, status, requested_at, reviewed_at, requested_by, reviewed_by, requested_note, review_notes",
        )
        .gte("requested_at", from)
        .lte("requested_at", until)
        .order("requested_at", { ascending: false })
        .limit(LIMIT),
    ),
    safe(
      supabase
        .from("jobs")
        .select("id, completed_at, completed_by, completion_notes")
        .not("completed_at", "is", null)
        .gte("completed_at", from)
        .lte("completed_at", until)
        .order("completed_at", { ascending: false })
        .limit(LIMIT),
    ),
    listProfiles().catch(() => []),
  ]);

  const crew = (
    crewRes as {
      id: string;
      kind: string;
      at: string;
      profile_id: string | null;
      job_id: string | null;
      note: string | null;
    }[]
  ).map(
    (r): CrewEventRow => ({
      id: r.id,
      kind: r.kind,
      at: r.at,
      profileId: r.profile_id,
      jobId: r.job_id,
      note: r.note,
    }),
  );

  const sessions = (
    sessionRes as {
      id: string;
      job_id: string;
      status: string;
      updated_at: string;
      pause_reason: string | null;
      purpose: string | null;
    }[]
  ).map(
    (r): SessionRow => ({
      id: r.id,
      jobId: r.job_id,
      status: r.status,
      at: r.updated_at,
      pauseReason: r.pause_reason,
      purpose: r.purpose,
    }),
  );

  const walks = walkRes as {
    id: string;
    job_id: string;
    status: string;
    requested_at: string;
    reviewed_at: string | null;
    requested_by: string | null;
    reviewed_by: string | null;
    requested_note: string | null;
    review_notes: string | null;
  }[];

  const milestones: MilestoneRow[] = [];
  for (const w of walks) {
    milestones.push({
      id: w.id,
      jobId: w.job_id,
      kind: "walkthrough_requested",
      at: w.requested_at,
      profileId: w.requested_by,
      detail: w.requested_note,
      outcome: null,
    });
    // The review is its own moment. Folding it into the request would lose the
    // gap between asking and being walked, which is the wait worth seeing.
    if (w.reviewed_at) {
      milestones.push({
        id: w.id,
        jobId: w.job_id,
        kind: "walkthrough_reviewed",
        at: w.reviewed_at,
        profileId: w.reviewed_by,
        detail: w.review_notes,
        outcome: w.status,
      });
    }
  }

  for (const j of doneRes as {
    id: string;
    completed_at: string;
    completed_by: string | null;
    completion_notes: string | null;
  }[]) {
    milestones.push({
      id: j.id,
      jobId: j.id,
      kind: "job_completed",
      at: j.completed_at,
      profileId: j.completed_by,
      detail: j.completion_notes,
      outcome: null,
    });
  }

  const jobIds = new Set(
    [
      ...crew.map((c) => c.jobId),
      ...sessions.map((s) => s.jobId),
      ...milestones.map((m) => m.jobId),
    ].filter((id): id is string => Boolean(id)),
  );

  const jobLabels = new Map<string, string>();
  if (jobIds.size > 0) {
    const { data: jobRows } = await supabase
      .from("jobs")
      .select("id, properties(address)")
      .in("id", [...jobIds]);
    for (const row of (jobRows ?? []) as unknown as {
      id: string;
      properties: { address: string } | null;
    }[]) {
      if (row.properties?.address)
        jobLabels.set(row.id, row.properties.address);
    }
  }

  const names = new Map<string, string>(
    profiles.map((p) => [p.id, p.full_name || p.email]),
  );

  return buildActivity(crew, sessions, milestones, names, jobLabels).slice(
    0,
    LIMIT,
  );
}
