/** Role names are free text an org defines itself — match loosely so
 * "Evaluator", "evaluator", "Account Manager", "account_manager" all count. */
export function qualifiesForAffiliateLink(roles: string[]): boolean {
  return roles.some((r) => {
    const normalized = r.toLowerCase().replace(/[_\s]+/g, " ").trim();
    return normalized === "evaluator" || normalized === "account manager";
  });
}
