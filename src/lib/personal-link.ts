import type { V2Role } from "@/lib/data/v2";

/**
 * Each person's own link to their page: /p/<their slug>.
 *
 * It is not a way in. Opened signed out it shows the sign-in form with their
 * email already filled in; signed in as them it goes straight to their own
 * role's page. Their affiliate link (/book?ref=...) is a separate link, for
 * clients.
 */
export function dashboardPath(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

/**
 * Where each role's own page is in the app. Everyone but an evaluator lands
 * on /me, their home drawn as the Project Hub's phone mock-ups draw it. A
 * person with several roles gets the first one here, in this order.
 */
const HOMES: [V2Role, string][] = [
  ["owner", "/me"],
  ["account-manager", "/me"],
  ["project-lead", "/me"],
  ["project-technician", "/me"],
  ["evaluator", "/v2/sales?choice=evaluations"],
  ["affiliate", "/me"],
];

export function roleHomePath(roles: readonly V2Role[]): string {
  return HOMES.find(([role]) => roles.includes(role))?.[1] ?? "/";
}

/** A name for a new slug: their first name, letters and digits only. */
export function slugBase(person: { full_name?: string | null; email?: string | null }): string {
  const name = (person.full_name ?? "").trim().split(/\s+/)[0] || (person.email ?? "").split("@")[0];
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "me";
}
