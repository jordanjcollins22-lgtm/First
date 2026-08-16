/**
 * One shape for everything that lands on the calendar, so evaluations and job
 * work days can share a grid, a day list, and a map instead of living in
 * separate views.
 *
 * The two are genuinely different underneath — an evaluation is one
 * appointment at a time on one day, a job is a run of work days — so they're
 * flattened here rather than forced into one database shape.
 *
 * Plain module, no "use client": both the server components that prepare the
 * page and the client calendar import from it.
 */

import type { JobWithLocation } from "@/lib/data/jobs";

export type CalendarLayer = "evaluations" | "jobs";

export const LAYER_LABELS: Record<CalendarLayer, string> = {
  evaluations: "Evaluations",
  jobs: "Jobs",
};

/** Matches the Jobs calendar's colour so the two agree wherever they appear. */
export const LAYER_COLORS: Record<CalendarLayer, string> = {
  evaluations: "#2f6d3c",
  jobs: "#b45309",
};

export interface CalendarEvent {
  /** Unique per day — a job spanning a week produces one per day. */
  id: string;
  layer: CalendarLayer;
  jobId: string;
  /** YYYY-MM-DD in local time. */
  date: string;
  /** Evaluations have a time; job work days are all-day. */
  at: string | null;
  address: string;
  customerName: string;
  lat: number;
  lng: number;
  assignedTo: string | null;
  /** Short status line shown next to the event. */
  detail: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A job that somehow spans months shouldn't paint the whole calendar; past
// this many days we show the first and last day only.
const MAX_SPAN_DAYS = 45;

function daysBetween(startKey: string, endKey: string): string[] {
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [startKey];

  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && out.length < MAX_SPAN_DAYS) {
    out.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  if (out.length >= MAX_SPAN_DAYS && out[out.length - 1] !== endKey) out.push(endKey);
  return out;
}

const EVALUATION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "Arrived",
  completed: "Completed",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  estimating: "Estimating",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Evaluations: one event on the day of the appointment. */
export function evaluationEvents(jobs: JobWithLocation[]): CalendarEvent[] {
  return jobs
    .filter((j) => j.evaluation_date)
    .map((j) => ({
      id: `eval-${j.id}`,
      layer: "evaluations" as const,
      jobId: j.id,
      date: dateKey(new Date(j.evaluation_date!)),
      at: j.evaluation_date,
      address: j.property.address,
      customerName: j.property.customer.name,
      lat: j.property.lat,
      lng: j.property.lng,
      assignedTo: j.assigned_to,
      detail: EVALUATION_STATUS_LABELS[j.evaluation_status] ?? "Evaluation",
    }));
}

/** Job work: one event per day the crew is booked, across the job's window. */
export function jobWorkEvents(jobs: JobWithLocation[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const j of jobs) {
    if (j.status === "completed" || j.status === "cancelled") continue;
    const start = j.project_start_date;
    const end = j.project_end_date;
    if (!start && !end) continue;

    for (const day of daysBetween(start ?? end!, end ?? start!)) {
      out.push({
        id: `job-${j.id}-${day}`,
        layer: "jobs",
        jobId: j.id,
        date: day,
        at: null,
        address: j.property.address,
        customerName: j.property.customer.name,
        lat: j.property.lat,
        lng: j.property.lng,
        assignedTo: j.assigned_to,
        detail: JOB_STATUS_LABELS[j.status] ?? j.status,
      });
    }
  }
  return out;
}

/** Groups events by day, evaluations first and timed ones in order, so a day
 * cell and the day list read the same way. */
export function eventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.layer !== b.layer) return a.layer === "evaluations" ? -1 : 1;
      return (a.at ?? "").localeCompare(b.at ?? "");
    });
  }
  return map;
}
