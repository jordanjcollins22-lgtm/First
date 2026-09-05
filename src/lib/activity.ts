/**
 * What the crew actually did, as it happens.
 *
 * The dashboard's piles say where a job *is*. This says what somebody *did* —
 * left the shop, arrived, started, had to pause, finished. It is the
 * difference between "on site now" and "on site since 7:52, paused at 10:15
 * waiting on a mulch delivery", and the second one is what stops the office
 * ringing round to find out.
 *
 * Three sources, deliberately merged rather than shown as three lists:
 *   crew day taps      — where a person is, hour by hour
 *   work session state — started, paused, and why, finished
 *   job milestones     — the manager's walk requested, the job signed off
 *
 * Nobody reading this cares which table a line came from. They care what
 * happened and when, so it is one feed in time order.
 */

export type ActivityKind =
  | "arrived_shop"
  | "left_shop"
  | "travelling"
  | "arrived_job"
  | "finished_job"
  | "returned_shop"
  | "session_started"
  | "session_paused"
  | "session_done"
  | "walkthrough_requested"
  | "walkthrough_reviewed"
  | "job_completed";

/** Lines that mean somebody is waiting on somebody else. Drawn out on the
 * screen, because a pause nobody notices is a day nobody gets back. */
const NEEDS_ATTENTION = new Set<ActivityKind>([
  "session_paused",
  "walkthrough_requested",
]);

export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  personName: string | null;
  jobId: string | null;
  /** Where it happened, as an address — the crew say "Crafton Road", not a id. */
  jobLabel: string | null;
  /** The line itself, already in words. */
  text: string;
  /** Whatever they typed: a pause reason, a punch list, a sign-off note. */
  detail: string | null;
  attention: boolean;
}

export interface CrewEventRow {
  id: string;
  kind: string;
  at: string;
  profileId: string | null;
  jobId: string | null;
  note: string | null;
}

export interface SessionRow {
  id: string;
  jobId: string;
  status: string;
  /** When the status last changed. */
  at: string;
  pauseReason: string | null;
  purpose: string | null;
}

export interface MilestoneRow {
  id: string;
  jobId: string;
  kind: "walkthrough_requested" | "walkthrough_reviewed" | "job_completed";
  at: string;
  profileId: string | null;
  detail: string | null;
  /** Only meaningful on a review: approved or rejected. */
  outcome: string | null;
}

const CREW_TEXT: Record<string, string> = {
  arrived_shop: "Arrived at the shop",
  left_shop: "Left the shop",
  travelling: "On the way",
  arrived_job: "Arrived on site",
  finished_job: "Finished up",
  returned_shop: "Back at the shop",
};

/**
 * Everything that happened, newest first.
 *
 * Names and addresses are looked up by the caller and passed in as maps
 * rather than joined per row — this runs over a whole day of taps from a whole
 * crew, and a lookup per line is how a dashboard gets slow without anybody
 * noticing why.
 */
export function buildActivity(
  crew: CrewEventRow[],
  sessions: SessionRow[],
  milestones: MilestoneRow[],
  names: Map<string, string>,
  jobLabels: Map<string, string>,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const label = (jobId: string | null) =>
    jobId ? (jobLabels.get(jobId) ?? null) : null;
  const person = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  for (const row of crew) {
    const text = CREW_TEXT[row.kind];
    // A tap of a kind this version does not know about is skipped rather than
    // printed raw. A feed is only useful if every line reads as English.
    if (!text) continue;
    items.push({
      id: `crew:${row.id}`,
      at: row.at,
      kind: row.kind as ActivityKind,
      personName: person(row.profileId),
      jobId: row.jobId,
      jobLabel: label(row.jobId),
      text,
      detail: row.note,
      attention: false,
    });
  }

  for (const row of sessions) {
    const kind =
      row.status === "in_progress"
        ? "session_started"
        : row.status === "paused"
          ? "session_paused"
          : row.status === "done"
            ? "session_done"
            : null;
    if (!kind) continue;

    items.push({
      id: `session:${row.id}:${row.status}`,
      at: row.at,
      kind,
      personName: null,
      jobId: row.jobId,
      jobLabel: label(row.jobId),
      text:
        kind === "session_started"
          ? "Work started"
          : kind === "session_paused"
            ? "Work paused"
            : "Visit finished",
      detail: kind === "session_paused" ? row.pauseReason : row.purpose,
      attention: NEEDS_ATTENTION.has(kind),
    });
  }

  for (const row of milestones) {
    const text =
      row.kind === "walkthrough_requested"
        ? "Asked for the manager's walk"
        : row.kind === "walkthrough_reviewed"
          ? row.outcome === "approved"
            ? "Walk approved"
            : "Walk rejected — punch list"
          : "Job signed off";

    items.push({
      id: `milestone:${row.id}:${row.kind}`,
      at: row.at,
      kind: row.kind,
      personName: person(row.profileId),
      jobId: row.jobId,
      jobLabel: label(row.jobId),
      text,
      detail: row.detail,
      attention: NEEDS_ATTENTION.has(row.kind) || row.outcome === "rejected",
    });
  }

  return items.sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1,
  );
}

/** The one-line answer to "what is going on" for the top of the feed. */
export function activityHeadline(items: ActivityItem[]): string {
  if (items.length === 0) return "Nothing logged yet.";
  const waiting = items.filter((i) => i.attention).length;
  if (waiting > 0) {
    return waiting === 1
      ? "1 thing is waiting on somebody."
      : `${waiting} things are waiting on somebody.`;
  }
  return items.length === 1 ? "1 update." : `${items.length} updates.`;
}
