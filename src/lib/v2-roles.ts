import type { V2Role } from "@/lib/data/v2";
import { hasRole, isOwnerLevel } from "@/lib/roles";

/**
 * Which of the new layout's views a person gets. Owners get everything;
 * everybody else gets the views for the roles they hold, and nothing more.
 */
export function v2RolesOf(person: { roles: readonly string[]; is_affiliate?: boolean | null; does_evaluations?: boolean | null }): V2Role[] {
  if (isOwnerLevel(person.roles)) return ["owner"];
  const names = person.roles.map((r) => r.toLowerCase());
  const out: V2Role[] = [];
  // "office" is the old name for the person running accounts from the desk.
  if (hasRole(person.roles, "account-manager") || names.includes("office")) out.push("account-manager");
  // Evaluations are a flag on the profile as often as a role.
  if (hasRole(person.roles, "evaluator") || person.does_evaluations) out.push("evaluator");
  if (hasRole(person.roles, "project-lead")) out.push("project-lead");
  if (hasRole(person.roles, "project-technician")) out.push("project-technician");
  // A commenter answers local posts with a tracked link: the affiliate's job.
  if (person.is_affiliate || names.includes("commenter")) out.push("affiliate");
  return out;
}

/** The pages each view has something on. Kept beside the pillars' `who` lists; a test checks they agree. */
export const V2_ROLE_PAGES: Record<V2Role, ("marketing" | "sales" | "operations" | "admin")[]> = {
  owner: ["marketing", "sales", "operations", "admin"],
  affiliate: ["marketing"],
  evaluator: ["sales"],
  "project-lead": ["operations"],
  "project-technician": ["operations"],
  "account-manager": ["sales", "admin"],
};

export function v2PagesFor(roles: readonly V2Role[]) {
  const all = ["marketing", "sales", "operations", "admin"] as const;
  return all.filter((p) => roles.some((r) => V2_ROLE_PAGES[r].includes(p)));
}
