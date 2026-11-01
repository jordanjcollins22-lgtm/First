/**
 * Department Kanban board rules, shared by the server actions and the board UI.
 *
 * Flow, left to right (matches the whiteboard):
 *   Backlog -> Breakdown [doing | Done] -> Answer [doing | Track | Done]
 *           -> Validate [doing | Done]
 *
 * "Track" holds answers that are waiting on an outside source. A card leaves
 * Track back to Answer (to keep working) or straight to Answer > Done.
 */

export const DEPARTMENTS = ["marketing", "sales", "operations", "admin"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  marketing: "Marketing",
  sales: "Sales",
  operations: "Operations",
  admin: "Admin",
};

export function isDepartment(value: string): value is Department {
  return (DEPARTMENTS as readonly string[]).includes(value);
}

/**
 * Every board runs two pipelines through the same columns, one above the
 * other: Client work and Team work. Each counts toward its own WIP limits.
 */
export const PIPELINES = ["client", "team"] as const;
export type Pipeline = (typeof PIPELINES)[number];

export const PIPELINE_LABELS: Record<Pipeline, string> = { client: "Client", team: "Team" };

export function isPipeline(value: string): value is Pipeline {
  return (PIPELINES as readonly string[]).includes(value);
}

export const STAGES = [
  "backlog",
  "breakdown",
  "breakdown_done",
  "answer",
  "answer_track",
  "answer_done",
  "validate",
  "validate_done",
] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/** Columns that have a WIP limit. Backlog and the final Done are unlimited. */
export type LimitedColumn = "breakdown" | "answer" | "validate";

export interface WipLimits {
  breakdown: number;
  answer: number;
  validate: number;
}

/**
 * Starting limits for a 1-2 person department. See the PR description for the
 * reasoning; each board can change these from its page.
 */
export const DEFAULT_WIP_LIMITS: WipLimits = { breakdown: 2, answer: 4, validate: 2 };

export interface ColumnDef {
  key: "backlog" | LimitedColumn;
  label: string;
  /** Sub-columns, left to right. */
  stages: { stage: Stage; label: string }[];
  /** Done rule shown on the board, from the whiteboard. */
  doneRule?: string;
}

export const COLUMNS: ColumnDef[] = [
  { key: "backlog", label: "Backlog", stages: [{ stage: "backlog", label: "Backlog" }] },
  {
    key: "breakdown",
    label: "Breakdown",
    stages: [
      { stage: "breakdown", label: "Doing" },
      { stage: "breakdown_done", label: "Done" },
    ],
    doneRule: "Takes under 2 minutes.",
  },
  {
    key: "answer",
    label: "Answer",
    stages: [
      { stage: "answer", label: "Doing" },
      { stage: "answer_track", label: "Track" },
      { stage: "answer_done", label: "Done" },
    ],
    doneRule: "Repeat the question, then give the answer.",
  },
  {
    key: "validate",
    label: "Validate",
    stages: [
      { stage: "validate", label: "Doing" },
      { stage: "validate_done", label: "Done" },
    ],
    doneRule: "Checked with the person who asked.",
  },
];

/** Which WIP-limited column a stage counts toward, if any. */
export function limitedColumnFor(stage: Stage): LimitedColumn | null {
  switch (stage) {
    case "breakdown":
    case "breakdown_done":
      return "breakdown";
    case "answer":
    case "answer_track":
    case "answer_done":
      return "answer";
    case "validate":
      return "validate";
    default:
      // Backlog and Validate > Done are unlimited.
      return null;
  }
}

/** The usual next step for a card, or null when it's finished. */
export function nextStage(stage: Stage): Stage | null {
  switch (stage) {
    case "backlog":
      return "breakdown";
    case "breakdown":
      return "breakdown_done";
    case "breakdown_done":
      return "answer";
    case "answer":
    case "answer_track":
      return "answer_done";
    case "answer_done":
      return "validate";
    case "validate":
      return "validate_done";
    case "validate_done":
      return null;
  }
}

/** One step back, for fixing a mistake. */
export function previousStage(stage: Stage): Stage | null {
  switch (stage) {
    case "backlog":
      return null;
    case "breakdown":
      return "backlog";
    case "breakdown_done":
      return "breakdown";
    case "answer":
      return "breakdown_done";
    case "answer_track":
      return "answer";
    case "answer_done":
      return "answer";
    case "validate":
      return "answer_done";
    case "validate_done":
      return "validate";
  }
}

export function countByColumn(stages: Stage[]): Record<LimitedColumn, number> {
  const counts: Record<LimitedColumn, number> = { breakdown: 0, answer: 0, validate: 0 };
  for (const s of stages) {
    const col = limitedColumnFor(s);
    if (col) counts[col] += 1;
  }
  return counts;
}

/**
 * Returns a message when moving a card from `from` to `to` would push a
 * column past its WIP limit, otherwise null. Moves inside the same column
 * (e.g. Doing -> Done, or into Track) never change that column's count.
 */
export function wipViolation(
  from: Stage,
  to: Stage,
  boardStages: Stage[],
  limits: WipLimits
): string | null {
  const target = limitedColumnFor(to);
  if (!target || target === limitedColumnFor(from)) return null;
  const count = countByColumn(boardStages)[target];
  if (count < limits[target]) return null;
  const label = COLUMNS.find((c) => c.key === target)!.label;
  return `${label} is full (${count} of ${limits[target]}). Finish or move a card on before pulling in another.`;
}

/** Position that puts a card at the bottom of a column. */
export function positionAtBottom(positions: number[]): number {
  return positions.length ? Math.max(...positions) + 1 : 0;
}

/** Position that puts a card at the top of a column. */
export function positionAtTop(positions: number[]): number {
  return positions.length ? Math.min(...positions) - 1 : 0;
}

/** Work for or with somebody outside the business: a client, a lead, a supplier. */
export const EXTERNAL_GROUP = "External";
/** Work on the business itself: a funnel, a process, a tool. */
export const INTERNAL_GROUP = "Internal";

/**
 * Groups inside a department's Backlog, used until the board saves its own.
 * Every Backlog splits outside work from work on the business. In Sales that
 * is the leads to reach out to, apart from building what converts them.
 */
export const DEFAULT_BACKLOG_GROUPS: Record<Department, string[]> = {
  marketing: [EXTERNAL_GROUP, INTERNAL_GROUP],
  sales: [EXTERNAL_GROUP, INTERNAL_GROUP],
  operations: [EXTERNAL_GROUP, INTERNAL_GROUP],
  admin: [EXTERNAL_GROUP, INTERNAL_GROUP],
};

/**
 * What one pipeline of a board asks of its Answer and Validate columns, and
 * its goals, until the board saves its own. Client and Team ask different
 * things. Marketing's come from Jordan's mockup: Client leads are closed into
 * jobs, Team leads into people who join the team.
 */
export interface BoardText {
  answerQuestion: string | null;
  validateQuestion: string | null;
  goals: string[];
}

export type BoardTexts = Record<Pipeline, BoardText>;

const NO_TEXT: BoardText = { answerQuestion: null, validateQuestion: null, goals: [] };

export const DEFAULT_BOARD_TEXT: Record<Department, BoardTexts> = {
  marketing: {
    client: {
      answerQuestion: "Did they book?",
      validateQuestion: "Did we close them?",
      goals: ["Get project leads"],
    },
    team: {
      answerQuestion: "Did they book an interview?",
      validateQuestion: "Did they join the team?",
      goals: ["Get team member leads"],
    },
  },
  sales: { client: NO_TEXT, team: NO_TEXT },
  operations: { client: NO_TEXT, team: NO_TEXT },
  admin: { client: NO_TEXT, team: NO_TEXT },
};

/** A question from a form, or null when left blank. */
export function parseQuestion(raw: unknown): string | null {
  const q = String(raw ?? "").trim().slice(0, 120);
  return q || null;
}

/** Goals from a form, one per line or comma-separated. Same rules as groups. */
export function parseGoals(raw: unknown): string[] {
  return parseBacklogGroups(raw);
}

/**
 * Groups that cards made from jobs and leads were filed under before every
 * Backlog was split into External and Internal. They are moved to External.
 */
export const LEGACY_EXTERNAL_GROUPS = ["Leads"];

/** Group names from a form: one per line or comma-separated, trimmed, no repeats. */
export function parseBacklogGroups(raw: unknown): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const part of String(raw ?? "").split(/[\n,]/)) {
    const name = part.trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    groups.push(name);
  }
  return groups.slice(0, 12);
}


/**
 * The Backlog split into its groups, in the board's order, each keeping its
 * cards' order. Cards with no group, or a group since removed, go under Other.
 */
export function groupBacklog<T extends { backlog_group: string | null }>(
  groups: readonly string[],
  cards: readonly T[]
): { name: string | null; cards: T[] }[] {
  const sections = groups.map((name) => ({ name: name as string | null, cards: [] as T[] }));
  const other: T[] = [];
  for (const card of cards) {
    const section = sections.find((s) => s.name === card.backlog_group);
    if (section) section.cards.push(card);
    else other.push(card);
  }
  if (other.length > 0 || sections.length === 0) sections.push({ name: null, cards: other });
  return sections;
}

export function parseWipLimit(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
}
