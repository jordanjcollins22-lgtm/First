/**
 * The commission pool: 15% of what a project brings in, split by who carried
 * it. 7% to the account manager, who prices it, sells it, runs it to sign-off
 * and collects; 4% to the evaluator, whose site map is the price; 4% to the
 * affiliate, who brought the lead.
 *
 * A share nobody earned -- no affiliate on a job booked from the website, say
 * -- stays with the business: prices are always set with the whole 15% in
 * them. One person can earn more than one share: whoever answers the post,
 * walks the property and manages the job earns all 15%. The owner earns none;
 * a share the owner filled stays with the business too.
 *
 * Projects sold before the split started keep the deal they were sold on:
 * the account manager at their own rate.
 *
 * Pure, so the rules are tested without a database.
 */

export const POOL_PCT = 15;

export type PoolRole = "account_manager" | "evaluator" | "affiliate";

export const SHARE_PCT: Record<PoolRole, number> = {
  account_manager: 7,
  evaluator: 4,
  affiliate: 4,
};

export const ROLE_LABEL: Record<PoolRole, string> = {
  account_manager: "Account manager",
  evaluator: "Evaluator",
  affiliate: "Affiliate",
};

/** The order a share is listed in: the one that carried it furthest first. */
const ORDER: PoolRole[] = ["account_manager", "evaluator", "affiliate"];

export interface JobRoles {
  accountManagerId: string | null;
  evaluatorId: string | null;
  affiliateId: string | null;
}

export interface PersonShare {
  profileId: string;
  roles: PoolRole[];
  pct: number;
}

/** Whether a project is split: sold on or after the day the split started. */
export function usesSplit(soldAt: string | null | undefined, splitFrom: string): boolean {
  if (!soldAt) return true;
  return soldAt.slice(0, 10) >= splitFrom.slice(0, 10);
}

/**
 * Who earns what on one project: each person once, with the shares they
 * filled added up. The owner, and anybody else passed in as not earning,
 * earns nothing; their share stays with the business.
 */
export function sharesFor(roles: JobRoles, notEarning: ReadonlySet<string> = new Set()): PersonShare[] {
  const by = new Map<string, PoolRole[]>();
  const holder: Record<PoolRole, string | null> = {
    account_manager: roles.accountManagerId,
    evaluator: roles.evaluatorId,
    affiliate: roles.affiliateId,
  };
  for (const role of ORDER) {
    const id = holder[role];
    if (!id || notEarning.has(id)) continue;
    by.set(id, [...(by.get(id) ?? []), role]);
  }
  return [...by.entries()].map(([profileId, list]) => ({
    profileId,
    roles: list,
    pct: list.reduce((sum, r) => sum + SHARE_PCT[r], 0),
  }));
}

/** What the business keeps of the pool: the shares nobody earned. */
export function keptPct(shares: PersonShare[]): number {
  return POOL_PCT - shares.reduce((sum, s) => sum + s.pct, 0);
}

/** "Account manager 7% + Evaluator 4%". */
export function describeShare(roles: PoolRole[]): string {
  return roles.map((r) => `${ROLE_LABEL[r]} ${SHARE_PCT[r]}%`).join(" + ");
}

/**
 * Whether a share is payable yet, beyond the money being in. The affiliate's
 * is payable as soon as the client pays; the account manager's and the
 * evaluator's at the final sign-off. The evaluator's is held while an issue
 * on the job traces back to the site map.
 */
export function shareRule(roles: PoolRole[], designIssues: number): { onCollect: boolean; hold: string | null } {
  const onCollect = roles.length > 0 && roles.every((r) => r === "affiliate");
  const hold =
    roles.includes("evaluator") && designIssues > 0
      ? designIssues === 1
        ? "An issue on this job traced back to the site map."
        : `${designIssues} issues on this job traced back to the site map.`
      : null;
  return { onCollect, hold };
}
