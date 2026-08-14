function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export function isEvaluator(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "evaluator");
}

export function isAccountManager(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "account manager");
}

/** Role names are free text an org defines itself — match loosely so
 * "Evaluator", "evaluator", "Account Manager", "account_manager" all count. */
export function qualifiesForAffiliateLink(roles: string[]): boolean {
  return isEvaluator(roles) || isAccountManager(roles);
}
