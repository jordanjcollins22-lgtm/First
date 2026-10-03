/**
 * The job, in the order somebody thinks about it.
 *
 * A job page with fifteen panels on it is a page where the thing you came for
 * is somewhere in the middle. The panels are already one-at-a-time; this puts
 * them under headings, so the crew member who wants the site map and the
 * office who wants the invoice are not scrolling past each other's work.
 *
 * Every panel keeps its own id, its own permission and its own component. This
 * says only which heading each one lives under.
 */

import type { JobStage } from "@/lib/job-stage";

export type JobTabKey = "overview" | "job" | "photos" | "messages" | "billing" | "closeout";

/**
 * Headings that used to exist, and where their contents live now.
 *
 * Links across the app still say ?view=scope or ?view=site. They should
 * land on the heading that has what they were pointing at, not on the
 * first tab because the name went away.
 */
const FORMER_TABS: Record<string, JobTabKey> = {
  field: "job",
  site: "job",
  scope: "job",
  plan: "job",
  issues: "job",
};

export function canonicalTab(key: string | null | undefined): JobTabKey | undefined {
  if (!key) return undefined;
  if (JOB_TABS.some((tab) => tab.key === key)) return key as JobTabKey;
  return FORMER_TABS[key];
}

export interface JobTab {
  key: JobTabKey;
  label: string;
  /** The section ids that live under it, in the order they belong. */
  sections: string[];
}

/**
 * Six headings, down from ten.
 *
 * Overview is the summary the page draws above everything. Job is the
 * work itself: the field screen at the top, then the site map, what the
 * client asked for, the proposal, the schedule, the crew, and the issues
 * and changes under it. Field, Site plan, Scope, Plan and Issues were five
 * headings for one thing, and the person on site was flicking between
 * them with a phone in one hand.
 */
export const JOB_TABS: readonly JobTab[] = [
  { key: "overview", label: "Overview", sections: [] },
  { key: "job", label: "Job", sections: ["map", "request", "proposal", "read", "schedule", "visits", "crew"] },
  { key: "photos", label: "Photos", sections: ["photos", "review", "marketing"] },
  { key: "messages", label: "Messages", sections: ["messages"] },
  { key: "billing", label: "Billing", sections: ["payment", "invoice"] },
  { key: "closeout", label: "Closeout", sections: ["walkthrough"] },
] as const;

const TAB_OF = new Map<string, JobTabKey>();
for (const tab of JOB_TABS) {
  for (const id of tab.sections) TAB_OF.set(id, tab.key);
}

/** Which heading a panel lives under. */
export function tabOfSection(id: string): JobTabKey | null {
  return TAB_OF.get(id) ?? null;
}

/**
 * The panels of one heading, in the order the heading lists them.
 *
 * A panel the page did not render -- because the viewer is not allowed it, or
 * because the job has no invoice yet -- simply is not there. The heading is
 * then empty, and the page leaves it out rather than showing a blank tab.
 */
export function sectionsForTab<T extends { id: string }>(sections: readonly T[], key: JobTabKey): T[] {
  const wanted = JOB_TABS.find((tab) => tab.key === key)?.sections ?? [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  return wanted.map((id) => byId.get(id)).filter((section): section is T => section != null);
}

/** Every panel that no heading claims, so one cannot be added and lost. */
export function unplacedSections<T extends { id: string }>(sections: readonly T[]): string[] {
  return sections.filter((section) => !TAB_OF.has(section.id)).map((section) => section.id);
}

/**
 * What the page shows at each stage, and nothing else.
 *
 * A booked evaluation used to open onto every heading the job will ever
 * have, with the ones it could not use yet shown as locked rows. That is
 * fifteen things on a phone for a visit that has one job: go and look at
 * it. So a heading or a panel that cannot be used yet is not shown at all.
 * The stage strip at the top still says what comes after.
 *
 * Nothing past the evaluation is available until the evaluation is
 * submitted. Nothing past the sale is available until it is sold. Work
 * and closeout open once the crew are on it.
 */
const SECTIONS_AT_STAGE: Record<JobStage, readonly string[]> = {
  evaluation: ["map", "request", "schedule", "photos", "messages"],
  cancelled: ["map", "request", "schedule", "photos", "messages"],
  pricing: ["map", "request", "proposal", "read", "schedule", "photos", "messages"],
  scheduled: ["map", "request", "proposal", "read", "schedule", "visits", "crew", "photos", "payment", "invoice", "messages"],
  working: ["map", "request", "proposal", "read", "schedule", "visits", "crew", "photos", "review", "marketing", "payment", "invoice", "messages", "walkthrough"],
  done: ["map", "request", "proposal", "read", "schedule", "visits", "crew", "photos", "review", "marketing", "payment", "invoice", "messages", "walkthrough"],
};

/** The headings with no panels of their own that still depend on the stage. */
const OWN_TABS_AT_STAGE: Record<JobStage, readonly JobTabKey[]> = {
  evaluation: ["overview", "job"],
  cancelled: ["overview", "job"],
  pricing: ["overview", "job"],
  scheduled: ["overview", "job"],
  working: ["overview", "job", "closeout"],
  done: ["overview", "job", "closeout"],
};

/** Whether the issues and changes list belongs under Job at this stage. */
export function issuesVisibleAtStage(stage: JobStage): boolean {
  return stage !== "evaluation" && stage !== "cancelled";
}

export function sectionVisibleAtStage(stage: JobStage, id: string): boolean {
  return SECTIONS_AT_STAGE[stage].includes(id);
}

export function tabVisibleAtStage(stage: JobStage, key: JobTabKey): boolean {
  if (OWN_TABS_AT_STAGE[stage].includes(key)) return true;
  const own = JOB_TABS.find((tab) => tab.key === key)?.sections ?? [];
  return own.some((id) => sectionVisibleAtStage(stage, id));
}

