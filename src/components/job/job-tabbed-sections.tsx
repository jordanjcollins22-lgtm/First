"use client";

import { issuesVisibleAtStage, JOB_TABS, sectionsForTab, sectionVisibleAtStage, tabVisibleAtStage, type JobTabKey } from "@/lib/job-tabs";
import type { JobStage } from "@/lib/job-stage";
import { JobSections, type JobSection } from "@/components/job/job-sections";
import { PageTabs, type PageTab } from "@/components/ui/page-tabs";

/**
 * The job under headings, with its panels still one at a time inside them.
 *
 * The panels were already an accordion, which is the right shape for a phone;
 * what was missing was any grouping, so a crew member wanting the site map
 * scrolled past the invoice and the office wanting the invoice scrolled past
 * the site map. The accordion stays exactly as it was, inside a heading.
 *
 * A heading with nothing under it -- because the viewer is not allowed those
 * panels, or the job has no invoice yet -- is not rendered at all. Nor is
 * anything the job cannot use at its stage: a booked evaluation shows what
 * an evaluation needs and nothing from the sale or the work after it.
 */
export function JobTabbedSections({
  sections,
  defaultOpen,
  overview,
  field,
  issues,
  closeout,
  initialTab,
  stage,
}: {
  sections: JobSection[];
  defaultOpen?: string | null;
  overview: React.ReactNode;
  field: React.ReactNode;
  issues: React.ReactNode;
  closeout?: React.ReactNode;
  initialTab?: string;
  /** Where the job is. Without it, everything the viewer may see is shown. */
  stage?: JobStage;
}) {
  // The field screen sits at the top of Job and the issues list under its
  // panels: what is happening on site first, the paperwork, then what went
  // wrong with it.
  const above: Partial<Record<JobTabKey, React.ReactNode>> = {
    overview,
    job: field,
    ...(closeout ? { closeout } : {}),
  };
  const below: Partial<Record<JobTabKey, React.ReactNode>> = {
    job: !stage || issuesVisibleAtStage(stage) ? issues : null,
  };

  const tabs: PageTab[] = JOB_TABS.flatMap((tab): PageTab[] => {
    if (stage && !tabVisibleAtStage(stage, tab.key)) return [];
    const mine = sectionsForTab(sections, tab.key).filter((s) => !stage || sectionVisibleAtStage(stage, s.id));
    const top = above[tab.key];
    const bottom = below[tab.key];
    if (mine.length === 0 && top == null && bottom == null) return [];
    return [{
      key: tab.key,
      label: tab.label,
      content: (
        <div className="space-y-4">
          {top}
          {mine.length > 0 && (
            <JobSections
              sections={mine}
              defaultOpen={mine.some((s) => s.id === defaultOpen) ? defaultOpen : mine.length === 1 ? mine[0].id : null}
            />
          )}
          {bottom}
        </div>
      ),
    }];
  });

  return <PageTabs tabs={tabs} initialKey={initialTab} param="view" />;
}
