import { calledInTime } from "@/lib/mow-calls";
import type { QuickMowStage } from "@/lib/quick-mow-pipeline";

/**
 * The quick mow funnel, level by level, from the people who tapped the link
 * to the money taken: how many reached each step, and how many of the step
 * before made it. Pure, so the arithmetic is tested without a database.
 */

export interface FunnelOrder {
  status: string;
  stage: QuickMowStage;
  tier: string | null;
  amountCents: number | null;
  createdAt: string;
  paidAt: string | null;
  calledAt: string | null;
  referralCode: string | null;
}

export interface FunnelCheck {
  inArea: boolean | null;
  referralCode: string | null;
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** Share of the step before that reached this one, 0 to 1. Null for the first step, or when the step before had nobody. */
  fromPrevious: number | null;
}

export interface Funnel {
  steps: FunnelStep[];
  revenueCents: number;
  /** Of everybody called, the share called within two minutes of asking (or of paying). */
  calledInTimeShare: number | null;
  calledCount: number;
  /** Paid revenue per tracked link, most first. */
  byLink: { code: string; requests: number; paid: number; revenueCents: number }[];
}

export function buildFunnel(input: { clicks: number; checks: FunnelCheck[]; orders: FunnelOrder[] }): Funnel {
  const { clicks, checks, orders } = input;
  const inArea = checks.filter((c) => c.inArea !== false).length;
  const sawPrice = orders.filter((o) => o.tier != null).length;
  const paid = orders.filter((o) => o.status === "paid");
  const mowed = orders.filter((o) => o.stage === "mowed").length;
  const counts: [string, string, number][] = [
    ["clicks", "Tapped the link", clicks],
    ["checked", "Checked their address", checks.length],
    ["in_area", "In our area", inArea],
    ["details", "Gave their details", orders.length],
    ["price", "Saw a price", sawPrice],
    ["paid", "Paid", paid.length],
    ["mowed", "Mowed", mowed],
  ];
  const steps = counts.map(([key, label, count], i) => {
    const before = i > 0 ? counts[i - 1][2] : 0;
    return { key, label, count, fromPrevious: i === 0 || before === 0 ? null : Math.min(1, count / before) };
  });

  const called = orders.filter((o) => o.calledAt);
  const inTime = called.filter((o) => calledInTime(o.paidAt ?? o.createdAt, o.calledAt));

  const links = new Map<string, { code: string; requests: number; paid: number; revenueCents: number }>();
  for (const o of orders) {
    const code = o.referralCode ?? "no link";
    const row = links.get(code) ?? { code, requests: 0, paid: 0, revenueCents: 0 };
    row.requests += 1;
    if (o.status === "paid") {
      row.paid += 1;
      row.revenueCents += o.amountCents ?? 0;
    }
    links.set(code, row);
  }

  return {
    steps,
    revenueCents: paid.reduce((sum, o) => sum + (o.amountCents ?? 0), 0),
    calledInTimeShare: called.length ? inTime.length / called.length : null,
    calledCount: called.length,
    byLink: [...links.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.requests - a.requests),
  };
}

export function percent(share: number | null): string {
  return share == null ? "—" : `${Math.round(share * 100)}%`;
}
