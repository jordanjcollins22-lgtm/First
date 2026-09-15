import Stripe from "stripe";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { env, isStripeConfigured } from "@/lib/env";
import { countsAsCash } from "@/lib/plaid";
import { paymentState } from "@/lib/proposal-payment";
import { creditLimitFrom, type Card, type CashPicture } from "@/lib/debt-plan";

/**
 * The four numbers the plan needs, from the four places they live.
 *
 * Nothing here decides anything. It gathers what is owed on the cards, what is
 * in the bank, what Stripe is holding, what clients still owe and what the
 * crew is owed, and hands them over. The judgement is in `debt-plan`, where it
 * can be tested without a bank.
 *
 * Every source is allowed to fail on its own. A Stripe outage should cost the
 * "on its way" figure and leave the rest of the plan standing, because the
 * card balances and the payroll are still true and still worth reading.
 */

export interface DebtInputs {
  cards: Card[];
  cash: CashPicture;
  /** When the bank balances were last read, so nobody trusts a stale figure. */
  balancesAt: string | null;
  /** What could not be reached, said plainly rather than shown as a zero. */
  missing: string[];
}

export async function getDebtInputs(): Promise<DebtInputs> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const missing: string[] = [];

  const { data: accounts } = await supabase
    .from("bank_accounts")
    .select(
      "id, name, mask, type, current_balance, available_balance, balance_at, credit_limit, apr, minimum_payment, payment_due_day"
    )
    .eq("organization_id", organizationId);

  const rows = accounts ?? [];
  if (rows.length === 0) missing.push("No bank or card accounts are linked.");

  const cards: Card[] = rows
    .filter((row) => !countsAsCash(row.type))
    .map((row) => ({
      id: row.id,
      name: row.name ?? "Card",
      mask: row.mask ?? null,
      balance: Number(row.current_balance) || 0,
      // The feed carries no limit, but for a card it carries the credit left,
      // and the two together are the limit.
      creditLimit: creditLimitFrom(
        row.credit_limit == null ? null : Number(row.credit_limit),
        Number(row.current_balance) || 0,
        row.available_balance == null ? null : Number(row.available_balance)
      ),
      apr: row.apr == null ? null : Number(row.apr),
      minimumPayment: row.minimum_payment == null ? null : Number(row.minimum_payment),
      dueDay: row.payment_due_day == null ? null : Number(row.payment_due_day),
    }));

  // Available rather than current. A current account showing twelve hundred
  // with eight hundred of it on hold cannot pay a card eight hundred, and a
  // plan built on the larger number is a plan that bounces.
  const inBank = rows
    .filter((row) => countsAsCash(row.type))
    .reduce((total, row) => {
      const available = row.available_balance == null ? null : Number(row.available_balance);
      return total + (available ?? (Number(row.current_balance) || 0));
    }, 0);

  const balancesAt = rows
    .map((row) => row.balance_at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1) ?? null;

  const [stripeIncoming, receivable, owedToCrew] = await Promise.all([
    stripeInTransit().catch(() => {
      missing.push("Stripe would not say what it is holding.");
      return 0;
    }),
    owedByClients(organizationId).catch(() => {
      missing.push("Could not work out what clients still owe.");
      return 0;
    }),
    owedToTheCrew(organizationId).catch(() => {
      missing.push("Could not work out what the crew is owed.");
      return 0;
    }),
  ]);

  return {
    cards,
    cash: { inBank: round(inBank), stripeIncoming, receivable, owedToCrew },
    balancesAt,
    missing,
  };
}

/**
 * What Stripe is holding that has not reached the bank.
 *
 * Available and pending together: both are ours, and neither is spendable
 * today, which is exactly how the plan treats them.
 */
async function stripeInTransit(): Promise<number> {
  if (!isStripeConfigured) return 0;
  const stripe = new Stripe(env.stripeSecretKey);
  const balance = await stripe.balance.retrieve();
  const cents = [...balance.available, ...balance.pending]
    .filter((entry) => entry.currency === "usd")
    .reduce((total, entry) => total + entry.amount, 0);
  return round(cents / 100);
}

/**
 * What clients still owe on work they have agreed to.
 *
 * Accepted proposals only. A proposal nobody has answered is not a debt owed
 * to us, and counting it would turn a hopeful pipeline into a payment plan.
 */
async function owedByClients(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_proposals")
    .select("job_id, total_cost, paid_at")
    .eq("organization_id", organizationId)
    .eq("status", "accepted");

  const proposals = data ?? [];
  if (proposals.length === 0) return 0;

  const { data: payments } = await supabase
    .from("payments")
    .select("job_id, amount_cents, surcharge_cents")
    .in("job_id", proposals.map((p) => p.job_id));

  const paidByJob = new Map<string, number>();
  for (const payment of payments ?? []) {
    if (!payment.job_id) continue;
    const cents = (payment.amount_cents ?? 0) - (payment.surcharge_cents ?? 0);
    paidByJob.set(payment.job_id, (paidByJob.get(payment.job_id) ?? 0) + cents);
  }

  let owed = 0;
  for (const proposal of proposals) {
    const totalCents = proposal.total_cost == null ? null : Math.round(Number(proposal.total_cost) * 100);
    const collectedCents = paidByJob.get(proposal.job_id) ?? 0;
    const facts = { totalCents, collectedCents, settledAt: proposal.paid_at };
    if (paymentState(facts) === "paid") continue;
    owed += Math.max(0, (totalCents ?? 0) - collectedCents);
  }
  return round(owed / 100);
}

/** Wages and commission written down and not yet handed over. */
async function owedToTheCrew(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_payments")
    .select("amount, status")
    .eq("organization_id", organizationId)
    .eq("status", "pending");
  return round((data ?? []).reduce((total, row) => total + (Number(row.amount) || 0), 0));
}

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}
