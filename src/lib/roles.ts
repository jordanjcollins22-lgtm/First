/**
 * Who somebody is, and therefore what the app should show them.
 *
 * The permissions matrix decides which pages a person can open, and it stays
 * the final word -- an admin ticking a box grants access, and nothing here
 * takes that away. What this file adds is the thing a tick cannot express:
 * *within* a page a person is allowed to open, which fields they should be
 * given at all.
 *
 * A project lead has to open the job they are running. They need the
 * measurements, the site map, the materials and the access notes, and they
 * must not be handed what the client is paying. Those are the same page. The
 * only honest way to do it is to decide per field, on the server, and never
 * send what somebody should not have -- a hidden div is not a permission, it
 * is a hidden div, and anybody who opens the network tab can read it.
 *
 * Role names are free text an organisation defines itself, so every match here
 * is loose: "Project Lead", "project_lead" and "PROJECT LEAD" are one role.
 * Anything unrecognised is nobody in particular, which grants nothing.
 */

export type RoleKey = "owner" | "account-manager" | "evaluator" | "project-lead" | "project-technician";

function normalise(role: string): string {
  return role.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

/**
 * The canonical name of each role: the one an admin ticks boxes against on the
 * Permissions screen, and the one `role_permissions` is keyed by.
 *
 * Owner-level is the exception and is deliberately two names rather than one.
 * `admin` is a system role three people hold and is not going anywhere;
 * `owner` exists beside it for a business that wants the distinction. Both
 * answer for the business, so both are owner-level.
 */
export const CANONICAL: Record<RoleKey, string[]> = {
  owner: ["owner", "admin"],
  "account-manager": ["account manager"],
  evaluator: ["evaluator"],
  "project-lead": ["project lead"],
  "project-technician": ["crew"],
};

/**
 * Names that are on their way out.
 *
 * `project lead` is a real role now, with its own row in `roles` and its own
 * grants in `role_permissions`. These are what people were called before it
 * existed, and they are honoured only so nobody loses a screen on the day the
 * role appeared -- an admin moves each person across in Settings, one at a
 * time, because a migration that reassigned people's roles at three in the
 * morning would be making a decision about people with nobody watching.
 *
 * Delete this table once nobody holds any of them; `roles.test.ts` names it so
 * the deletion is a visible change rather than a forgotten one.
 */
export const LEGACY_ALIASES: Partial<Record<RoleKey, string[]>> = {
  owner: ["manager"],
  "project-lead": ["lead", "foreman"],
  "project-technician": ["technician"],
};

/** Every name a role answers to: the canonical ones, plus what it used to be. */
const NAMES: Record<RoleKey, string[]> = Object.fromEntries(
  (Object.keys(CANONICAL) as RoleKey[]).map((key) => [key, [...CANONICAL[key], ...(LEGACY_ALIASES[key] ?? [])]])
) as Record<RoleKey, string[]>;

export function roleKeysOf(roles: readonly string[]): RoleKey[] {
  const held = roles.map(normalise);
  return (Object.keys(NAMES) as RoleKey[]).filter((key) => NAMES[key].some((name) => held.includes(name)));
}

export function hasRole(roles: readonly string[], key: RoleKey): boolean {
  return roleKeysOf(roles).includes(key);
}

/** Owner, admin or manager: the people who answer for the business. */
export function isOwnerLevel(roles: readonly string[]): boolean {
  return hasRole(roles, "owner");
}

/**
 * What one job costs and what has been paid on it.
 *
 * The account manager owns the client relationship and cannot do it without
 * the billing context -- what was quoted, what was invoiced, what is
 * outstanding. The people running and doing the work do not need any of it,
 * and a crew member reading the margin on the job they are standing in is a
 * conversation nobody wants to have in a garden.
 */
export function canSeeJobMoney(roles: readonly string[]): boolean {
  return isOwnerLevel(roles) || hasRole(roles, "account-manager");
}

/**
 * Payroll, the bank, overhead and margin.
 *
 * Narrower than job money on purpose: an account manager quotes and invoices
 * without ever seeing what the business pays its people or what it keeps.
 * This is the same set the database itself gates the ledger on, so what a
 * screen shows and what a table allows cannot drift apart.
 */
export function canSeeCompanyMoney(roles: readonly string[]): boolean {
  return roles.map(normalise).some((role) => role === "admin" || role === "owner" || role === "overhead");
}

/**
 * Whether this person's world is one job at a time.
 *
 * A technician is given the task, the place and the instructions. Browsing
 * other people's jobs is not a thing they are stopped from doing out of
 * suspicion -- it is that a list of forty jobs is noise to somebody whose
 * question is "what am I doing next".
 */
export function isTaskScoped(roles: readonly string[]): boolean {
  const keys = roleKeysOf(roles);
  if (keys.length === 0) return false;
  return keys.every((key) => key === "project-technician");
}

/** Whether the person may run a job: confirmations, crew, field completion. */
export function canRunJobs(roles: readonly string[]): boolean {
  return isOwnerLevel(roles) || hasRole(roles, "account-manager") || hasRole(roles, "project-lead");
}

/** Whether the person may sell: proposals, pricing, client negotiation. */
export function canSell(roles: readonly string[]): boolean {
  return isOwnerLevel(roles) || hasRole(roles, "account-manager");
}

export interface FieldVisibility {
  /** Proposal totals, invoices and payments on this job. */
  jobMoney: boolean;
  /** Payroll, bank, overhead, margin. */
  companyMoney: boolean;
  /** The operational detail: quantities, site plan, access, disposal. */
  operationalDetail: boolean;
  /** Whether they may change what the job is: scope, schedule, crew. */
  manageJob: boolean;
  /** Whether they see other people's work at all. */
  otherPeoplesWork: boolean;
}

/**
 * What to send this person, field by field.
 *
 * Assembled once at the top of a page and used to decide what is *loaded*,
 * not merely what is rendered. A panel that is not in the answer cannot leak.
 */
export function visibilityFor(roles: readonly string[]): FieldVisibility {
  return {
    jobMoney: canSeeJobMoney(roles),
    companyMoney: canSeeCompanyMoney(roles),
    // Everybody who goes near a job needs this; it is the work itself.
    operationalDetail: true,
    manageJob: canRunJobs(roles),
    otherPeoplesWork: !isTaskScoped(roles),
  };
}

/**
 * The modules a role would see if nobody had configured anything.
 *
 * Defaults only. The permissions matrix is consulted first and wins wherever
 * it has an opinion: this is what a role means before an admin has said
 * otherwise, not a second lock on the door.
 */
export const DEFAULT_MODULES: Record<RoleKey, string[]> = {
  owner: ["my-day", "sales", "schedule", "jobs", "marketing", "more"],
  "account-manager": ["my-day", "sales", "schedule", "jobs", "marketing"],
  evaluator: ["my-day", "sales", "schedule"],
  "project-lead": ["my-day", "schedule", "jobs", "more"],
  "project-technician": ["my-day"],
};

/**
 * The subtabs a role would see, where the module is narrower than the whole.
 *
 * An evaluator opening Sales gets Evaluations and nothing else -- not a
 * greyed-out Pipeline, not an empty Proposals. A door that opens on a refusal
 * is worse than no door.
 */
export const DEFAULT_SUBTABS: Partial<Record<RoleKey, Record<string, string[]>>> = {
  evaluator: { sales: ["evaluations"], schedule: ["calendar", "weather"] },
  "project-lead": { jobs: ["upcoming", "ready", "active", "attention"], more: ["inventory", "field-guide"] },
  "project-technician": {},
  "account-manager": { more: [] },
};

/** Whether a role would see this module by default. */
export function defaultShowsModule(roles: readonly string[], moduleKey: string): boolean {
  const keys = roleKeysOf(roles);
  if (keys.length === 0) return true;
  return keys.some((key) => DEFAULT_MODULES[key].includes(moduleKey));
}

/**
 * The subtabs a role would see in a module by default, or null for "all of
 * them". Several roles at once are added together, never subtracted.
 */
export function defaultSubtabs(roles: readonly string[], moduleKey: string): string[] | null {
  const keys = roleKeysOf(roles);
  if (keys.length === 0) return null;
  const lists = keys.map((key) => DEFAULT_SUBTABS[key]?.[moduleKey]);
  // Any role with no opinion about this module means the whole module.
  if (lists.some((list) => list == null)) return null;
  return [...new Set(lists.flat().filter((key): key is string => key != null))];
}
