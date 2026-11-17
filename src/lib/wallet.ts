import type { CommissionLine, CommissionSummary } from "@/lib/commission";

/**
 * The affiliate's wallet, the pure parts. Their 4% lands here once the
 * client pays, not in their bank. Getting it to the bank is a payout
 * request: the office approves it, sends it, and marks it sent. Nothing in
 * the wallet moves money by itself.
 */

export type PayoutStatus = "requested" | "approved" | "declined" | "sent" | "cancelled";

export interface PayoutRequestRow {
  id: string;
  profileId: string;
  person?: string;
  amount: number;
  status: PayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  sentAt: string | null;
  method: string | null;
  reference: string | null;
}

/** A payout to their bank, as the office recorded it. */
export interface PaidOut {
  amount: number;
  at: string;
}

export interface WalletEntry {
  label: string;
  /** Plus for earned, minus for paid out. */
  amount: number;
  at: string | null;
}

export interface Wallet {
  /** In the wallet: the client has paid, and it hasn't gone to their bank yet. */
  ready: number;
  /** Their 4% of what clients still owe on projects they brought in. */
  waiting: number;
  /** Earned, but held while something on the job is put right. */
  onHold: number;
  /** A request still with the office, if there is one. */
  open: PayoutRequestRow | null;
  /** What a new request can be for: what's ready, less anything already asked for. */
  canRequest: number;
  history: WalletEntry[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isOpenRequest(r: Pick<PayoutRequestRow, "status">): boolean {
  return r.status === "requested" || r.status === "approved";
}

function waitingOn(line: CommissionLine): number {
  return Math.max(0, line.outstanding) * (line.pct / 100);
}

export function walletFor(summary: CommissionSummary | null, requests: PayoutRequestRow[], paidOut: PaidOut[], limit = 6): Wallet {
  const lines = summary?.lines ?? [];
  const ready = round2(summary?.earned ?? 0);
  const onHold = round2(summary?.held ?? 0);
  const waiting = round2(lines.reduce((sum, l) => sum + waitingOn(l), 0));
  const open = requests.find(isOpenRequest) ?? null;
  const canRequest = open ? 0 : ready;

  const earned: WalletEntry[] = lines
    .filter((l) => l.earnedTotal > 0)
    .map((l) => ({ label: `${lastName(l.customerName)} project`, amount: round2(l.earnedTotal), at: l.completedAt }));
  const out: WalletEntry[] = paidOut.map((p) => ({ label: "Paid out to your bank", amount: -round2(p.amount), at: p.at }));
  const history = [...earned, ...out]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, limit);

  return { ready, waiting, onHold, open, canRequest, history };
}

/** A payout recorded as several job rows on one day is one payout to them. */
export function groupPayouts(rows: { amount: number; paid_at: string; reference: string | null }[]): PaidOut[] {
  const by = new Map<string, PaidOut>();
  for (const r of rows) {
    const key = `${r.paid_at.slice(0, 10)}|${r.reference ?? ""}`;
    const seen = by.get(key);
    if (seen) seen.amount = round2(seen.amount + (Number(r.amount) || 0));
    else by.set(key, { amount: round2(Number(r.amount) || 0), at: r.paid_at });
  }
  return [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Which jobs a payout covers: the oldest money in the wallet first, up to the
 * amount sent. One row per job is how the office's ledger already records
 * commission, so "has that one been paid" still has an answer.
 */
export function allocatePayout(lines: CommissionLine[], amount: number): { jobId: string; amount: number }[] {
  let left = round2(amount);
  const out: { jobId: string; amount: number }[] = [];
  const earned = lines
    .filter((l) => l.state === "earned" && l.amount > 0)
    .sort((a, b) => (a.completedAt ?? "9999").localeCompare(b.completedAt ?? "9999"));
  for (const l of earned) {
    if (left <= 0) break;
    const take = round2(Math.min(l.amount, left));
    out.push({ jobId: l.jobId, amount: take });
    left = round2(left - take);
  }
  return out;
}

/** Why a payout request can't go in, or null when it can. */
export function whyNotRequest(wallet: Pick<Wallet, "ready" | "open">): string | null {
  if (wallet.open) return "You already asked. It's with the office.";
  if (wallet.ready <= 0) return "Nothing is ready to pay out yet. It lands here once the client pays.";
  return null;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || "Client";
}
