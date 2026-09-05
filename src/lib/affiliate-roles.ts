function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export function isEvaluator(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "evaluator");
}

/** Somebody who works jobs. Matched loosely, like every other role check here,
 * because role names are free text an org defines itself. */
export function isCrew(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "crew");
}

export function isAccountManager(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "account manager");
}

/** Role names are free text an org defines itself — match loosely so
 * "Evaluator", "evaluator", "Account Manager", "account_manager" all count. */
export function qualifiesForAffiliateLink(roles: string[]): boolean {
  return isEvaluator(roles) || isAccountManager(roles);
}

/**
 * Roles that run the business rather than do the work.
 *
 * Anybody holding one of these needs the full app. Everybody else is in a
 * truck, and the full app is noise to them.
 */
const OFFICE_ROLES = ["admin", "owner", "overhead", "evaluator", "account manager", "manager"];

export function isOfficeRole(role: string): boolean {
  return OFFICE_ROLES.includes(normalizeRole(role));
}

/**
 * Whether this person only works in the field.
 *
 * Decides the landing screen and how much navigation to show. Deliberately
 * "holds no office role" rather than "holds the crew role": somebody given a
 * custom role like "Foreman" is still in a truck, and defaulting them into the
 * office view would be the wrong way to be wrong. Somebody with no roles at
 * all is not field-only — they are unconfigured, and quietly locking them to
 * one screen would hide the fact that nobody has set them up.
 */
export function isFieldOnly(roles: string[]): boolean {
  if (roles.length === 0) return false;
  return !roles.some(isOfficeRole);
}
