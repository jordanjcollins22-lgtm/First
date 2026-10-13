/**
 * The owner's task list: the build tasks the new layout still needs, plus
 * anything the owner adds.
 *
 * It used to live in one browser's localStorage, so a tick on the laptop
 * was not a tick on the phone and nobody else could see it. Now it is a
 * table. What is here is the vocabulary and the starting list; the seed
 * migration (0356b) writes the same items, and a test keeps them in step.
 *
 * Pure: no reads, no writes.
 */

export const TASK_STATUSES = ["todo", "not_built", "partly_built", "in_progress", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  not_built: "Not built",
  partly_built: "Partly built",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Done and dropped are off the list; everything else is still open. */
export function isOpenTask(status: TaskStatus): boolean {
  return status !== "done" && status !== "dropped";
}

export const TASK_SECTIONS = ["Marketing", "Sales", "Operations", "Admin", "Other"] as const;
export type TaskSection = (typeof TASK_SECTIONS)[number];

export function isTaskSection(value: string): value is TaskSection {
  return (TASK_SECTIONS as readonly string[]).includes(value);
}

export interface SeedTask {
  section: TaskSection;
  title: string;
  status: TaskStatus;
  note: string;
}

/** The 33 items from the v2 Task list, word for word. */
export const TASK_SEED: SeedTask[] = [
  { section: "Marketing", title: "Google Ads", status: "not_built", note: "No account connected. Bookings already record ad click IDs." },
  { section: "Marketing", title: "Website", status: "partly_built", note: "Website editor and live previews are here. Still to do: point the business's own domain at /site, and add photos and reviews to it." },
  { section: "Marketing", title: "Door hangers & mail", status: "partly_built", note: "Numbers are here. Planning a run or a mailing is still only in the current app." },
  { section: "Marketing", title: "Lead lists", status: "partly_built", note: "Counts are here. Importing and working a list is still only in the current app." },
  { section: "Marketing", title: "Email campaigns", status: "partly_built", note: "Campaigns are listed. Writing and starting one is still only in the current app." },
  { section: "Marketing", title: "Property managers", status: "partly_built", note: "Numbers are here. Approving the emails is still only in the current app." },
  { section: "Marketing", title: "Local groups", status: "partly_built", note: "Groups are listed. Group rules and paid posts are still only in the current app." },
  { section: "Marketing", title: "What worked", status: "partly_built", note: "Revenue by channel is here." },
  { section: "Marketing", title: "SEO", status: "partly_built", note: "Reviews work. Keyword tracker is empty; Business Profile stats not connected." },
  { section: "Marketing", title: "Social media › Facebook & Nextdoor", status: "partly_built", note: "Tracked links work. Scheduled posts aren't publishing on their date." },
  { section: "Marketing", title: "Social media › Instagram, Google Business posts, TikTok, YouTube", status: "not_built", note: "Nothing on these channels yet." },
  { section: "Marketing", title: "Affiliates", status: "partly_built", note: "Codes and links work. Commission payouts never recorded; rates on file aren't 4%." },
  { section: "Marketing", title: "Affiliate-only view", status: "not_built", note: "An affiliate signing in should land on the comment responder only." },
  { section: "Sales", title: "Evaluation booking", status: "partly_built", note: "Booking and availability work. Routing by area and workload not built." },
  { section: "Sales", title: "Proposals › Pricing formulas", status: "partly_built", note: "Most active services have no rate set." },
  { section: "Sales", title: "Automated follow-up", status: "partly_built", note: "Proposal and invoice follow-ups work. No-show rebook and seasonal re-engage not built." },
  { section: "Sales", title: "My evaluations (evaluator view)", status: "partly_built", note: "The evaluator's visit screens exist; no evaluator-only home in the new layout." },
  { section: "Sales", title: "Evaluators", status: "partly_built", note: "Roster and pay are on profiles. No performance view." },
  { section: "Operations", title: "Scheduling", status: "partly_built", note: "Work days exist. Auto-placement and weather reschedule not built; past work days don't close." },
  { section: "Operations", title: "Materials & ordering", status: "partly_built", note: "Materials and suppliers work. Purchase orders and delivery tracking not built." },
  { section: "Operations", title: "Completion & close-out", status: "partly_built", note: "Walkthroughs and reviews work. Job costing is rarely filled in." },
  { section: "Operations", title: "My projects (project lead view)", status: "not_built", note: "No project leads yet and no lead-only home." },
  { section: "Operations", title: "My day (project tech view)", status: "partly_built", note: "My Day and crew check-ins exist; no tech-only home in the new layout." },
  { section: "Operations", title: "Project team", status: "partly_built", note: "Roster and pay exist. Performance view not built." },
  { section: "Admin", title: "Departments", status: "partly_built", note: "Alerts are computed here; goals per department not built." },
  { section: "Admin", title: "Customer accounts", status: "partly_built", note: "Contacts and messages exist. One timeline per customer not built." },
  { section: "Admin", title: "Users & permissions", status: "partly_built", note: "Map the old roles onto the new ones and per-tab access." },
  { section: "Admin", title: "Integrations", status: "partly_built", note: "GoHighLevel, Stripe, email and banks work. Google Ads not connected." },
  { section: "Admin", title: "Company & compliance", status: "partly_built", note: "Locations and designs exist. Insurance, licenses, contracts and legal wording not built." },
  { section: "Admin", title: "Settings", status: "partly_built", note: "Services list exists (with duplicates). Service area and notification settings need a screen." },
  { section: "Admin", title: "Account managers", status: "partly_built", note: "Role exists. Assignments and oversight not built." },
  { section: "Admin", title: "Hiring (account managers)", status: "not_built", note: "The hiring flow covers project tech and project lead only." },
  { section: "Admin", title: "Switch the main address to the new layout", status: "not_built", note: "Last step, once everything above is done." },
];

export interface TaskRow {
  id: string;
  section: string;
  title: string;
  note: string | null;
  status: TaskStatus;
  position: number;
  doneAt: string | null;
  updatedAt: string;
}

/** Sections in page order, then position, then title, so the list never jumps. */
export function sortTasks<T extends Pick<TaskRow, "section" | "position" | "title">>(tasks: readonly T[]): T[] {
  const rank = (s: string) => {
    const i = (TASK_SECTIONS as readonly string[]).indexOf(s);
    return i === -1 ? TASK_SECTIONS.length : i;
  };
  return [...tasks].sort((a, b) => rank(a.section) - rank(b.section) || a.position - b.position || a.title.localeCompare(b.title));
}

export interface TaskCounts {
  notBuilt: number;
  partlyBuilt: number;
  open: number;
  done: number;
}

export function countTasks(tasks: readonly Pick<TaskRow, "status">[]): TaskCounts {
  return {
    notBuilt: tasks.filter((t) => t.status === "not_built").length,
    partlyBuilt: tasks.filter((t) => t.status === "partly_built").length,
    open: tasks.filter((t) => isOpenTask(t.status)).length,
    done: tasks.filter((t) => t.status === "done").length,
  };
}

/** A tick moves a task to done; un-ticking puts it back where it plainly was. */
export function toggledStatus(current: TaskStatus, previous: TaskStatus | null): TaskStatus {
  if (current === "done") return previous && previous !== "done" ? previous : "todo";
  return "done";
}

/** A single quote doubled, for the seed migration's string literals. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The seed migration's VALUES rows, exactly as 0356b writes them. */
export function seedValuesSql(): string {
  return TASK_SEED.map(
    (t, i) => `  (${sqlString(t.section)}, ${sqlString(t.title)}, ${sqlString(t.status)}, ${sqlString(t.note)}, ${i + 1})`
  ).join(",\n");
}
