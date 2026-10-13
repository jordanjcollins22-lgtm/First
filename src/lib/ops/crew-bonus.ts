/**
 * The budgeted-hours bonus: $X a week to each crew member whose jobs came in
 * under the hours they were priced at.
 *
 * Off unless the owner turns it on. One documented New Jersey program pays
 * +$50 a week per crew member when hours are hit, and found it cheaper than
 * the overtime it replaced (Landscape Management, "Incentive insight").
 *
 * Judged per person, on the jobs they worked that finished that week: a crew
 * member is not docked for a job somebody else ran over on. A job with no
 * budget is left out rather than counted as a pass, so the bonus cannot be
 * earned on work nobody priced.
 */

export interface BonusRule {
  enabled: boolean;
  perMemberCents: number;
}

export interface FinishedJobWeek {
  jobId: string;
  budgetHours: number | null;
  actualHours: number;
  /** Everybody who logged time on the job. */
  crew: string[];
}

export interface PersonBonus {
  profileId: string;
  jobIds: string[];
  budgetHours: number;
  actualHours: number;
  earned: boolean;
  amountCents: number;
  reason: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function weeklyBonuses(rule: BonusRule, jobs: readonly FinishedJobWeek[]): PersonBonus[] {
  const byPerson = new Map<string, FinishedJobWeek[]>();
  for (const job of jobs) {
    for (const person of new Set(job.crew)) {
      const list = byPerson.get(person) ?? [];
      list.push(job);
      byPerson.set(person, list);
    }
  }

  const out: PersonBonus[] = [];
  for (const [profileId, list] of byPerson) {
    const budgeted = list.filter((j) => j.budgetHours != null && j.budgetHours > 0);
    const budgetHours = round1(budgeted.reduce((s, j) => s + (j.budgetHours ?? 0), 0));
    const actualHours = round1(budgeted.reduce((s, j) => s + j.actualHours, 0));
    let earned = false;
    let reason: string;
    if (!rule.enabled) reason = "The bonus is switched off.";
    else if (budgeted.length === 0) reason = "No finished job with budgeted hours this week.";
    else if (actualHours <= budgetHours) {
      earned = true;
      reason = `${actualHours}h against ${budgetHours}h budgeted.`;
    } else reason = `${actualHours}h against ${budgetHours}h budgeted: over.`;
    out.push({
      profileId,
      jobIds: budgeted.map((j) => j.jobId),
      budgetHours,
      actualHours,
      earned,
      amountCents: earned ? Math.max(0, Math.round(rule.perMemberCents)) : 0,
      reason,
    });
  }
  return out.sort((a, b) => a.profileId.localeCompare(b.profileId));
}

/** The Monday that starts the week holding this day, YYYY-MM-DD. */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
