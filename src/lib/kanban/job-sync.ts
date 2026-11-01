/**
 * Keeping the Operations backlog in step with the job board.
 *
 * Every job that still needs doing gets one card. The order is the team's:
 * a new job joins at the bottom, and the top card is the priority. The first
 * time the board fills, jobs already underway go first, then the rest by
 * start date, so the starting order is a sensible one to reorder from.
 */

import { viewOf, type BoardJob } from "@/lib/job-board";
import { EXTERNAL_GROUP, type Stage } from "@/lib/kanban/board";

export interface JobCardLink {
  id: string;
  job_id: string;
  stage: Stage;
}

export interface NewJobCard {
  job_id: string;
  title: string;
  asked_by: string | null;
  details: string | null;
  backlog_group: string;
}

/** Whether a job is work that still needs doing. */
export function isOpenJob(job: BoardJob): boolean {
  const view = viewOf(job.status, job.declined);
  return view === "upcoming" || view === "active";
}

function formatStart(iso: string): string {
  // A date-only value is a calendar day, not a moment: read it as written.
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function cardForJob(job: BoardJob): NewJobCard {
  const number = job.jobNumber != null ? `#${job.jobNumber} ` : "";
  const parts = [
    job.address,
    job.workStartsOn ? `Starts ${formatStart(job.workStartsOn)}` : "No work day booked yet",
    job.assignedToName ? `Assigned to ${job.assignedToName}` : null,
  ].filter(Boolean);
  return {
    job_id: job.id,
    title: `${number}${job.name}`,
    // A job is work for a client: outside work.
    backlog_group: EXTERNAL_GROUP,
    asked_by: job.customerName,
    details: parts.join("\n") || null,
  };
}

/** Underway first, then by start date, undated last. */
function seedOrder(a: BoardJob, b: BoardJob): number {
  const active = (j: BoardJob) => (viewOf(j.status, j.declined) === "active" ? 0 : 1);
  if (active(a) !== active(b)) return active(a) - active(b);
  const start = (j: BoardJob) => j.workStartsOn ?? j.startsOn ?? "9999";
  return start(a).localeCompare(start(b));
}

/**
 * What to change: cards to add for open jobs that have none, and Backlog
 * cards to drop because their job is finished, cancelled or declined. A card
 * somebody has already pulled past Backlog is theirs to finish, so it stays.
 */
export function planJobSync(jobs: readonly BoardJob[], cards: readonly JobCardLink[]) {
  const open = jobs.filter(isOpenJob);
  const openIds = new Set(open.map((j) => j.id));
  const carded = new Set(cards.map((c) => c.job_id));

  const toAdd = open
    .filter((j) => !carded.has(j.id))
    .sort(seedOrder)
    .map(cardForJob);
  const toRemove = cards.filter((c) => c.stage === "backlog" && !openIds.has(c.job_id)).map((c) => c.id);
  return { toAdd, toRemove };
}
