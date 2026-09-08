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

export type JobTabKey =
  | "overview"
  | "field"
  | "site"
  | "scope"
  | "plan"
  | "issues"
  | "photos"
  | "messages"
  | "billing"
  | "closeout";

export interface JobTab {
  key: JobTabKey;
  label: string;
  /** The section ids that live under it, in the order they belong. */
  sections: string[];
}

/**
 * Overview and Field hold no accordion sections: Overview is the summary the
 * page already draws above everything, and Field is its own flat screen built
 * for a phone in a garden rather than a list of panels to open.
 */
export const JOB_TABS: readonly JobTab[] = [
  { key: "overview", label: "Overview", sections: [] },
  { key: "field", label: "Field", sections: [] },
  { key: "site", label: "Site plan", sections: ["map"] },
  { key: "scope", label: "Scope", sections: ["proposal", "request"] },
  { key: "plan", label: "Plan", sections: ["schedule", "crew", "visits"] },
  { key: "issues", label: "Issues & changes", sections: [] },
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
