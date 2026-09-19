/**
 * People watching a project who are not the client.
 *
 * A property manager, a management company, a landlord, a spouse who is not on
 * the paperwork. They need to know how the work is going. They have no
 * business seeing what it costs, and nobody should be asking them to approve
 * anything — the client already did that, and a second approve button is a
 * second place a job can be accepted by the wrong person.
 *
 * So this is the client's view with the money and the decisions taken out.
 * Absent from the shape rather than hidden by the component, the same
 * guarantee the crew sheet makes: there is nowhere here to put a price, so no
 * future change to a page can leak one.
 */

import { deriveStage, type JobStage, type StageInput } from "@/lib/job-stage";

export type ObserverRelationship =
  | "property_manager"
  | "management_company"
  | "family"
  | "tenant"
  | "landlord"
  | "other";

export const RELATIONSHIPS: { value: ObserverRelationship; label: string }[] = [
  { value: "property_manager", label: "Property manager" },
  { value: "management_company", label: "Management company" },
  { value: "family", label: "Family" },
  { value: "tenant", label: "Tenant" },
  { value: "landlord", label: "Landlord" },
  { value: "other", label: "Other" },
];

const RELATIONSHIP_LABELS = new Map(RELATIONSHIPS.map((r) => [r.value, r.label]));

export function relationshipLabel(value: string): string {
  return RELATIONSHIP_LABELS.get(value as ObserverRelationship) ?? "Other";
}

/**
 * What each stage means to somebody who is not doing the work.
 *
 * The crew's labels are about what happens next; these are about what has
 * happened, because that is the question a watcher opened the page with.
 */
export const OBSERVER_STAGE_LABELS: Record<JobStage, string> = {
  evaluation: "Being looked at",
  pricing: "Being priced",
  scheduled: "Booked in",
  working: "Work under way",
  done: "Finished",
  cancelled: "Cancelled",
};

export const OBSERVER_STAGE_BLURBS: Record<JobStage, string> = {
  evaluation: "We're coming out to walk the property and measure up.",
  pricing: "We've been out. The proposal is being put together.",
  scheduled: "Approved and on the calendar.",
  working: "The crew are on it.",
  done: "The work is complete.",
  cancelled: "This project was called off.",
};

/** Where the project has got to, as a strip somebody can read at a glance. */
export const OBSERVER_STEPS: JobStage[] = ["evaluation", "pricing", "scheduled", "working", "done"];

export interface ObserverZone {
  name: string;
  /** What is being done there, in words. No quantities, no line items — those
   * are the client's business and read as a bill. */
  service: string;
  location: string;
  notes: string;
  photos: { path: string; markers: { x: number; y: number }[] }[];
}

export interface ObserverVisit {
  startsOn: string;
  endsOn: string;
  /** scheduled, in_progress, paused, done — what the crew recorded. */
  status: string;
  purpose: string | null;
}

export interface ObserverProject {
  address: string;
  customerName: string;
  organizationName: string;
  stage: JobStage;
  /** Who to ring. The office's contact, never a crew member's mobile. */
  contact: { name: string; phone: string | null } | null;
  zones: ObserverZone[];
  visits: ObserverVisit[];
  evaluationDate: string | null;
  completedAt: string | null;
  watcherName: string;
  relationship: ObserverRelationship;
}

/**
 * How far along, as a fraction, for the progress strip.
 *
 * Cancelled has no position on a strip that runs from "looked at" to
 * "finished" — it is an absence of progress, not a point in it — so it returns
 * null and the page says so in words instead.
 */
export function stageProgress(stage: JobStage): number | null {
  if (stage === "cancelled") return null;
  const index = OBSERVER_STEPS.indexOf(stage);
  if (index < 0) return null;
  return (index + 1) / OBSERVER_STEPS.length;
}

/** The stage, from the same inputs every other screen derives it from, so a
 * watcher can never be told something the job page disagrees with. */
export function observerStage(input: StageInput): JobStage {
  return deriveStage(input);
}

/**
 * The one line at the top: what is happening, in the present tense.
 *
 * Dates where there are dates, because "booked in" without a day is the answer
 * that makes somebody ring to ask the actual question.
 */
export function headline(project: Pick<ObserverProject, "stage" | "visits" | "evaluationDate">): string {
  if (project.stage === "cancelled") return OBSERVER_STAGE_BLURBS.cancelled;

  if (project.stage === "evaluation" && project.evaluationDate) {
    return `We're coming out on ${formatDay(project.evaluationDate)}.`;
  }

  const next = project.visits.find((v) => v.status === "scheduled" || v.status === "in_progress");
  if (project.stage === "scheduled" && next) {
    return `Booked in for ${formatDay(next.startsOn)}.`;
  }
  if (project.stage === "working") {
    const paused = project.visits.find((v) => v.status === "paused");
    if (paused) return "Work has started and is paused for the moment.";
    return "The crew are on it.";
  }
  return OBSERVER_STAGE_BLURBS[project.stage];
}

function formatDay(value: string): string {
  const date = new Date(value.length > 10 ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
