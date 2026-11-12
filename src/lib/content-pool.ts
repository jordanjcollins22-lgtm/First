/**
 * The marketing team's content profit pool.
 *
 * 25% of the profit (the price less labour, materials and the shares paid
 * on it, as the job's estimate worked it out) on every job that came from
 * our content, split evenly across the marketing team: everybody who hands
 * out tracked links, the owner aside.
 *
 * A job counts as coming from content only when it came in through a
 * tracked link on one of our posts. The link is the only way to know the
 * true source, so every post needs one: a post without a link earns nothing
 * because nobody can tell a job came from it.
 *
 * When it is paid out is not decided yet; this only adds it up.
 *
 * Pure, so the rule is tested without a database.
 */

export const CONTENT_POOL_PCT = 25;

export interface PoolLead {
  /** Came in through a tracked link on one of our posts. */
  fromContent: boolean;
  sold: boolean;
  /** The job's profit, in dollars, when its estimate worked one out. */
  profit: number | null;
}

export interface ContentPool {
  /** Sold jobs that came from content. */
  jobs: number;
  /** Of those, the ones with no profit worked out, so not in the pool yet. */
  unpriced: number;
  profit: number;
  pool: number;
  /** Each team member's even share. */
  perPerson: number;
  team: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function contentPool(leads: PoolLead[], team: string[], pct: number = CONTENT_POOL_PCT): ContentPool {
  let jobs = 0;
  let unpriced = 0;
  let profit = 0;
  for (const lead of leads) {
    if (!lead.fromContent || !lead.sold) continue;
    jobs += 1;
    if (lead.profit == null) unpriced += 1;
    else profit += Math.max(0, lead.profit);
  }
  const pool = round2((profit * pct) / 100);
  return { jobs, unpriced, profit: round2(profit), pool, perPerson: team.length ? round2(pool / team.length) : 0, team };
}
