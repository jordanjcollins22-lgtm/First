import { getRecurringBoard } from "@/lib/data/recurring";
import type { OverheadBreakdown } from "@/lib/overhead";

/**
 * What the business costs to keep open, from the bank.
 *
 * This used to read a table of five round numbers somebody typed from memory.
 * They were close, which was the problem: close is not true, and nobody could
 * tell which of the five was wrong or by how much. Every one of them was
 * already in the transactions.
 *
 * Derived means it moves on its own. The rent goes up in March and the number
 * the quotes are built on goes up in March, with nobody remembering to edit
 * anything.
 *
 * Shares the read with the Subscriptions screen through React's per-request
 * cache, so a page showing both does not go through six months of transactions
 * twice.
 */
export async function getOverhead(): Promise<OverheadBreakdown> {
  const board = await getRecurringBoard();
  return board.overhead;
}
