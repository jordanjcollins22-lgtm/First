import { describe, expect, it } from "vitest";
import {
  byCredit,
  byOwed,
  neverBilled,
  reconcile,
  reconcileLine,
  type BankedRow,
  type BilledRow,
} from "./accounting-reconcile";

const bill = (customerId: string, amountCents: number, name: string | null = "Jane"): BilledRow => ({
  customerId,
  customerName: name,
  amountCents,
  settled: false,
});

const paid = (customerId: string | null, amountCents: number): BankedRow => ({
  customerId,
  amountCents,
});

describe("reconcile", () => {
  it("puts billed and banked next to each other per contact", () => {
    const r = reconcile([bill("a", 819000)], [paid("a", 400000)]);
    const [balance] = r.balances;
    expect(balance.billedCents).toBe(819000);
    expect(balance.receivedCents).toBe(400000);
    expect(balance.owedCents).toBe(419000);
    expect(balance.creditCents).toBe(0);
  });

  it("shows money taken beyond the bill rather than netting it away", () => {
    // Usually work invoiced outside this system. Hiding it makes the two
    // totals disagree with no explanation on screen.
    const r = reconcile([bill("a", 100000)], [paid("a", 150000)]);
    expect(r.balances[0].owedCents).toBe(0);
    expect(r.balances[0].creditCents).toBe(50000);
  });

  it("never lets one client's overpayment cancel another's debt", () => {
    // The whole reason owed is summed per contact rather than as one
    // subtraction. A single subtraction here would report nothing owed.
    const r = reconcile([bill("a", 100000), bill("b", 100000)], [paid("a", 200000)]);
    expect(r.owedCents).toBe(100000);
    expect(r.creditCents).toBe(100000);
    expect(r.billedCents).toBe(200000);
    expect(r.receivedCents).toBe(200000);
  });

  it("keeps money matched to nobody out of every balance and still reports it", () => {
    const r = reconcile([bill("a", 100000)], [paid(null, 787520)]);
    expect(r.unattributedCents).toBe(787520);
    expect(r.receivedCents).toBe(0);
    expect(r.balances).toHaveLength(1);
    expect(r.balances[0].owedCents).toBe(100000);
  });

  it("counts somebody who paid without ever being billed", () => {
    const r = reconcile([], [paid("a", 500000)]);
    expect(r.balances[0].invoices).toBe(0);
    expect(r.balances[0].creditCents).toBe(500000);
  });

  it("adds up several invoices to one contact", () => {
    const r = reconcile([bill("a", 100000), bill("a", 50000)], [paid("a", 120000)]);
    expect(r.balances[0].billedCents).toBe(150000);
    expect(r.balances[0].invoices).toBe(2);
    expect(r.balances[0].owedCents).toBe(30000);
  });

  it("keeps a name from whichever row carried one", () => {
    const r = reconcile([bill("a", 1000, null), bill("a", 1000, "Roger Johnson")], []);
    expect(r.balances[0].customerName).toBe("Roger Johnson");
  });

  it("has an answer for an empty book", () => {
    const r = reconcile([], []);
    expect(r.billedCents).toBe(0);
    expect(r.balances).toEqual([]);
  });
});

describe("the work queues", () => {
  const r = reconcile(
    [bill("a", 100000, "Owes a lot"), bill("b", 20000, "Owes a little"), bill("c", 10000, "Square")],
    [paid("a", 0), paid("c", 10000), paid("d", 300000)]
  );

  it("puts the biggest gap first", () => {
    expect(byOwed(r.balances).map((b) => b.customerName)).toEqual(["Owes a lot", "Owes a little"]);
  });

  it("leaves out anybody who is square", () => {
    expect(byOwed(r.balances).map((b) => b.customerId)).not.toContain("c");
  });

  it("names the money with no invoice behind it", () => {
    expect(byCredit(r.balances).map((b) => b.customerId)).toEqual(["d"]);
  });

  it("names who paid and was never billed through the app", () => {
    // The back catalogue: everybody a proposal still has to be written for.
    expect(neverBilled(r.balances).map((b) => b.customerId)).toEqual(["d"]);
  });
});

describe("reconcileLine", () => {
  it("states the gap rather than leaving somebody to subtract", () => {
    const line = reconcileLine(reconcile([bill("a", 819000)], [paid("a", 400000)]));
    expect(line).toMatch(/\$8,190 billed/);
    expect(line).toMatch(/\$4,000 received/);
    expect(line).toMatch(/\$4,190 still owed/);
  });

  it("says so when there is nothing yet", () => {
    expect(reconcileLine(reconcile([], []))).toMatch(/nothing billed/i);
  });
});
