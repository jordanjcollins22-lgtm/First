/**
 * Old roles onto the new ones.
 *
 * The new layout, the permissions defaults and the field visibility all
 * speak five RoleKeys (src/lib/roles.ts). Role names are free text an
 * organisation invents, so people end up holding names nothing recognises
 * ("office", "commenter"), old names on their way out ("foreman",
 * "technician"), or none at all. Each of those is somebody the app quietly
 * treats as nobody in particular.
 *
 * This finds them and proposes one fix each. It never changes anybody by
 * itself: the owner taps the fix, because reassigning people's roles with
 * nobody watching is making a decision about people.
 *
 * Pure, so the rules are tested without a database.
 */

import { CANONICAL, LEGACY_ALIASES, roleKeysOf, type RoleKey } from "@/lib/roles";

export const ROLE_KEY_LABEL: Record<RoleKey, string> = {
  owner: "Owner",
  "account-manager": "Account manager",
  evaluator: "Evaluator",
  "project-lead": "Project lead",
  "project-technician": "Project technician (crew)",
};

/** The role name to grant for a RoleKey: the first canonical name. */
export function canonicalName(key: RoleKey): string {
  return CANONICAL[key][0];
}

function normalise(role: string): string {
  return role.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export interface PersonForMapping {
  id: string;
  name: string;
  roles: string[];
  isAffiliate: boolean;
  doesEvaluations: boolean | null;
  trialCrew: boolean;
  payType: string | null;
}

export type MappingProblem = "unmapped" | "legacy" | "conflict";

export interface RoleFix {
  /** Role names to add. */
  add: string[];
  /** Role names to take away. */
  remove: string[];
  /** In words, on the button. */
  label: string;
}

export interface MappingFinding {
  profileId: string;
  name: string;
  roles: string[];
  problem: MappingProblem;
  /** What is wrong, in a sentence. */
  detail: string;
  fix: RoleFix;
}

/**
 * The likeliest RoleKey for somebody who holds none. A guess for the button,
 * which the owner can change before tapping.
 */
export function suggestRoleKey(p: PersonForMapping): RoleKey {
  if (p.trialCrew) return "project-technician";
  if (p.doesEvaluations) return "evaluator";
  if (p.payType === "commission" || p.payType === "both" || p.isAffiliate) return "account-manager";
  return "project-technician";
}

/** Which legacy alias, if any, a role name is, and what it maps to. */
function legacyKeyOf(role: string): RoleKey | null {
  const n = normalise(role);
  for (const [key, names] of Object.entries(LEGACY_ALIASES) as [RoleKey, string[]][]) {
    if (names.includes(n)) return key;
  }
  return null;
}

/**
 * Everybody whose roles need a decision.
 *
 * - unmapped: holds no RoleKey at all.
 * - legacy: holds an old name; the fix swaps it for the canonical one.
 * - conflict: crew (task-scoped: one job at a time) alongside a role that
 *   runs or sells work. The two pull opposite ways on what the person sees,
 *   and the broader one wins anyway, so the crew role is noise to remove.
 */
export function findRoleProblems(people: PersonForMapping[]): MappingFinding[] {
  const out: MappingFinding[] = [];
  for (const p of people) {
    const roles = p.roles.filter(Boolean);
    const keys = roleKeysOf(roles);

    if (keys.length === 0) {
      const key = suggestRoleKey(p);
      const held = roles.length ? `Holds ${roles.map((r) => `"${r}"`).join(", ")}, which none of the five roles recognise.` : "Holds no role.";
      out.push({
        profileId: p.id,
        name: p.name,
        roles,
        problem: "unmapped",
        detail: `${held} The app treats them as nobody in particular.`,
        fix: { add: [canonicalName(key)], remove: [], label: `Make ${ROLE_KEY_LABEL[key].toLowerCase()}` },
      });
      continue;
    }

    const legacy = roles.map((r) => ({ role: r, key: legacyKeyOf(r) })).filter((x): x is { role: string; key: RoleKey } => x.key != null);
    if (legacy.length > 0) {
      const add = [...new Set(legacy.map((l) => canonicalName(l.key)))].filter((name) => !roles.map(normalise).includes(name));
      out.push({
        profileId: p.id,
        name: p.name,
        roles,
        problem: "legacy",
        detail: `Holds the old name${legacy.length > 1 ? "s" : ""} ${legacy.map((l) => `"${l.role}"`).join(", ")}.`,
        fix: {
          add,
          remove: legacy.map((l) => l.role),
          label: `Move to ${[...new Set(legacy.map((l) => ROLE_KEY_LABEL[l.key].toLowerCase()))].join(" and ")}`,
        },
      });
      continue;
    }

    const crewNames = roles.filter((r) => CANONICAL["project-technician"].includes(normalise(r)));
    const broader = keys.filter((k) => k !== "project-technician");
    if (crewNames.length > 0 && broader.length > 0) {
      out.push({
        profileId: p.id,
        name: p.name,
        roles,
        problem: "conflict",
        detail: `Crew alongside ${broader.map((k) => ROLE_KEY_LABEL[k].toLowerCase()).join(" and ")}: crew means one job at a time, the other means more.`,
        fix: { add: [], remove: crewNames, label: "Remove crew" },
      });
    }
  }
  const order: Record<MappingProblem, number> = { unmapped: 0, conflict: 1, legacy: 2 };
  return out.sort((a, b) => order[a.problem] - order[b.problem] || a.name.localeCompare(b.name));
}
