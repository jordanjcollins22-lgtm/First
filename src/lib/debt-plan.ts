/**
 * What to pay, out of what has actually arrived.
 *
 * The business carries card debt, owes its crew, and is owed by clients, and
 * those three numbers lived on three screens that never met. Deciding what to
 * pay each month meant holding all of it in your head, which is how a card
 * ends up over its limit while money sits in a current account.
 *
 * Two rules run through everything here.
 *
 * **Only money that has arrived is spendable.** An accepted proposal is not
 * cash and neither is a Stripe balance still in transit. Both are shown, and
 * both are shown apart from what can be paid today, because a plan that spends
 * an invoice nobody has settled is how a payroll run bounces.
 *
 * **The crew is paid before any card.** A card charges interest for being
 * late; a person who is not paid stops turning up, and is owed the money
 * whatever the cards say. So wages come off the top and what is left is the
 * only thing this allocates.
 *
 * After that it is the plain arithmetic: cover every minimum so nothing takes
 * a late fee, then put whatever remains against the dearest debt, because a
 * pound against a card at twenty-six per cent beats the same pound against one
 * at fourteen and no judgement is involved.
 *
 * Everything is in whole currency units, not cents. These are bank balances,
 * which arrive as decimals and are read by a person.
 */

export interface Card {
  id: string;
  name: string;
  /** The last four, for telling two cards from the same bank apart. */
  mask: string | null;
  /** What is owed. Positive is debt. */
  balance: number;
  creditLimit: number | null;
  /** Annual rate as a percentage, e.g. 24.99. Null when nobody has said. */
  apr: number | null;
  /** What the statement demands this month. Null when nobody has said. */
  minimumPayment: number | null;
  /** Day of the month it is due. Null when nobody has said. */
  dueDay: number | null;
}

export interface CashPicture {
  /** In the current accounts and available to spend today. */
  inBank: number;
  /** With Stripe and on its way, but not landed. */
  stripeIncoming: number;
  /** Sold work that has not been paid for. Not spendable. */
  receivable: number;
  /** Wages and commission owed but not yet handed over. */
  owedToCrew: number;
}

export interface Allocation {
  cardId: string;
  name: string;
  amount: number;
  /** Why this card got this much, in words. */
  why: string;
}

export type WarningLevel = "urgent" | "watch";

export interface Warning {
  level: WarningLevel;
  message: string;
}

export interface DebtPlan {
  /** Everything owed on cards. */
  debt: number;
  /** What the statements demand between them, where they are known. */
  minimums: number;
  /** Money in the bank, less what the crew is owed and the reserve. */
  payableToday: number;
  /** What could be paid once everything outstanding lands. */
  payableWhenPaid: number;
  /** Today's recommendation, card by card. */
  today: Allocation[];
  /** The same once the outstanding money is in. */
  whenPaid: Allocation[];
  warnings: Warning[];
  /** Balance over limit, as a fraction, per card. */
  utilisation: { cardId: string; name: string; used: number | null }[];
}

/**
 * A card's limit, from the statement or from the feed.
 *
 * The bank does not send a limit, but for a card it sends how much credit is
 * left — so the limit is what is owed plus what is still available. That is
 * worth deriving rather than waiting for somebody to type it in, because it is
 * what turns "you owe $3,857" into "you are $458 over your limit", which is
 * the sentence that actually changes what somebody does today.
 *
 * A typed-in limit wins. Somebody who has read their statement knows better
 * than an arithmetic trick.
 */
export function creditLimitFrom(
  explicit: number | null,
  balance: number,
  available: number | null
): number | null {
  if (explicit != null && explicit > 0) return explicit;
  if (available == null || !Number.isFinite(available)) return null;
  const derived = balance + available;
  return derived > 0 ? Math.round(derived * 100) / 100 : null;
}

/** Kept back rather than paid out, so a bounced direct debit is not the plan. */
export const DEFAULT_RESERVE = 500;

/** Over this much of a card used, it is worth saying so. */
const HIGH_UTILISATION = 0.8;

/**
 * The whole picture, and what to do about it.
 *
 * Two allocations rather than one: what today's money covers, and what the
 * same rules would do once the outstanding invoices land. The second is the
 * plan to work towards; the first is the only one safe to act on.
 */
export function planDebt(
  cards: Card[],
  cash: CashPicture,
  options: { reserve?: number } = {}
): DebtPlan {
  const reserve = Math.max(0, options.reserve ?? DEFAULT_RESERVE);
  const owing = cards.filter((card) => card.balance > 0);

  const debt = round(owing.reduce((total, card) => total + card.balance, 0));
  const minimums = round(
    owing.reduce((total, card) => total + Math.min(card.minimumPayment ?? 0, card.balance), 0)
  );

  const payableToday = round(Math.max(0, cash.inBank - cash.owedToCrew - reserve));
  const payableWhenPaid = round(
    Math.max(0, cash.inBank + cash.stripeIncoming + cash.receivable - cash.owedToCrew - reserve)
  );

  return {
    debt,
    minimums,
    payableToday,
    payableWhenPaid,
    today: allocate(owing, payableToday),
    whenPaid: allocate(owing, payableWhenPaid),
    warnings: warningsFor(owing, cash, { reserve, minimums, payableToday }),
    utilisation: owing.map((card) => ({
      cardId: card.id,
      name: card.name,
      used: card.creditLimit && card.creditLimit > 0 ? card.balance / card.creditLimit : null,
    })),
  };
}

/**
 * Spread a pot of money across the cards.
 *
 * Minimums first, in due-date order, so the nearest deadline is covered before
 * a card that is not due for three weeks. Then everything left against the
 * dearest debt until it is gone, then the next dearest.
 *
 * A card with no rate set is treated as the cheapest rather than the dearest.
 * Guessing high would send real money to a card on the strength of a number
 * nobody entered.
 */
function allocate(cards: Card[], pot: number): Allocation[] {
  let left = round(pot);
  if (left <= 0 || cards.length === 0) return [];

  const paid = new Map<string, number>();
  const give = (card: Card, amount: number) => {
    const give = Math.min(round(amount), left, round(card.balance - (paid.get(card.id) ?? 0)));
    if (give <= 0) return 0;
    paid.set(card.id, round((paid.get(card.id) ?? 0) + give));
    left = round(left - give);
    return give;
  };

  const reasons = new Map<string, string>();

  for (const card of [...cards].sort(byDueDate)) {
    const minimum = Math.min(card.minimumPayment ?? 0, card.balance);
    if (minimum <= 0) continue;
    const given = give(card, minimum);
    if (given > 0) {
      reasons.set(
        card.id,
        given < minimum
          ? `Part of the minimum — there is not enough to cover it`
          : `The minimum, due ${ordinal(card.dueDay)}`
      );
    }
  }

  for (const card of [...cards].sort(byRate)) {
    if (left <= 0) break;
    const before = paid.get(card.id) ?? 0;
    const given = give(card, card.balance - before);
    if (given <= 0) continue;
    reasons.set(
      card.id,
      before > 0
        ? `${reasons.get(card.id)}, plus the rest against the dearest debt${rate(card)}`
        : `Everything spare against the dearest debt${rate(card)}`
    );
  }

  return cards
    .filter((card) => (paid.get(card.id) ?? 0) > 0)
    .map((card) => ({
      cardId: card.id,
      name: card.name,
      amount: paid.get(card.id)!,
      why: reasons.get(card.id) ?? "",
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** Nearest deadline first. A card with no due day set goes last. */
function byDueDate(a: Card, b: Card): number {
  return (a.dueDay ?? 99) - (b.dueDay ?? 99);
}

/** Dearest debt first. A card with no rate set is treated as the cheapest. */
function byRate(a: Card, b: Card): number {
  return (b.apr ?? -1) - (a.apr ?? -1);
}

function rate(card: Card): string {
  return card.apr == null ? "" : ` at ${card.apr}%`;
}

function ordinal(day: number | null): string {
  if (day == null) return "this month";
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `on the ${day}${suffix}`;
}

/**
 * What is about to go wrong.
 *
 * Ordered by how soon it hurts. Wages that cannot be met is the first thing
 * anybody needs to know; a card at eighty per cent of its limit is the last.
 */
function warningsFor(
  cards: Card[],
  cash: CashPicture,
  facts: { reserve: number; minimums: number; payableToday: number }
): Warning[] {
  const out: Warning[] = [];

  if (cash.owedToCrew > cash.inBank) {
    out.push({
      level: "urgent",
      message: `The crew is owed ${money(cash.owedToCrew)} and there is ${money(cash.inBank)} in the bank. Wages come before any card.`,
    });
  }

  if (facts.minimums > facts.payableToday) {
    const short = round(facts.minimums - facts.payableToday);
    out.push({
      level: "urgent",
      message: `Card minimums come to ${money(facts.minimums)} and only ${money(facts.payableToday)} is free today — short by ${money(short)}.`,
    });
  }

  for (const card of cards) {
    if (card.creditLimit && card.balance > card.creditLimit) {
      out.push({
        level: "urgent",
        message: `${card.name} is ${money(card.balance - card.creditLimit)} over its limit.`,
      });
    } else if (card.creditLimit && card.balance / card.creditLimit >= HIGH_UTILISATION) {
      out.push({
        level: "watch",
        message: `${card.name} is at ${Math.round((card.balance / card.creditLimit) * 100)}% of its limit.`,
      });
    }
  }

  const unset = cards.filter((card) => card.apr == null || card.minimumPayment == null);
  if (unset.length > 0) {
    out.push({
      level: "watch",
      message: `${unset.map((c) => c.name).join(", ")} ${unset.length === 1 ? "has" : "have"} no rate or minimum set, so ${unset.length === 1 ? "it is" : "they are"} left out of the plan. Add them from the statement.`,
    });
  }

  return out;
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(amount: number): string {
  return MONEY.format(amount);
}

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}
