import { describe, expect, it } from "vitest";
import { chargeIdsIn, dropRepeatChargeIds, splitByExistingCharge } from "./payment-dedupe";

type Row = { external_id: string; stripe_payment_intent_id: string | null; amount_cents: number };

const row = (external_id: string, charge: string | null, amount = 100): Row => ({
  external_id,
  stripe_payment_intent_id: charge,
  amount_cents: amount,
});

describe("splitByExistingCharge", () => {
  it("updates the row already holding the charge instead of adding a second", () => {
    // The webhook recorded this one live. The export now brings the same
    // charge round with its own transaction id on it.
    const existing = new Map([["ch_1", "payment-uuid"]]);
    const { updates, inserts } = splitByExistingCharge([row("txn_1", "ch_1")], existing);

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("payment-uuid");
    // Everything the export knows still lands on the row.
    expect(updates[0].external_id).toBe("txn_1");
  });

  it("inserts a charge nothing has seen", () => {
    const { updates, inserts } = splitByExistingCharge([row("txn_2", "ch_2")], new Map());
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("inserts a payment with no charge id at all", () => {
    // Cash and cheques carry nothing from a processor. Nulls never collide.
    const existing = new Map([["ch_1", "payment-uuid"]]);
    const { updates, inserts } = splitByExistingCharge([row("txn_3", null)], existing);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("keeps the two apart in one mixed batch", () => {
    const existing = new Map([["ch_1", "a"]]);
    const { updates, inserts } = splitByExistingCharge(
      [row("t1", "ch_1"), row("t2", "ch_2"), row("t3", null)],
      existing
    );
    expect(updates.map((u) => u.external_id)).toEqual(["t1"]);
    expect(inserts.map((i) => i.external_id)).toEqual(["t2", "t3"]);
  });
});

describe("dropRepeatChargeIds", () => {
  it("lets only the first row claim a repeated charge id", () => {
    // A repeat inside one batch fails the whole batch, not the one row.
    const out = dropRepeatChargeIds([row("t1", "ch_1"), row("t2", "ch_1")]);
    expect(out[0].stripe_payment_intent_id).toBe("ch_1");
    expect(out[1].stripe_payment_intent_id).toBeNull();
  });

  it("still records the money on the row it took the id from", () => {
    const out = dropRepeatChargeIds([row("t1", "ch_1", 500), row("t2", "ch_1", 700)]);
    expect(out[1].amount_cents).toBe(700);
    expect(out[1].external_id).toBe("t2");
  });

  it("leaves distinct ids and nulls alone", () => {
    const out = dropRepeatChargeIds([row("t1", "ch_1"), row("t2", "ch_2"), row("t3", null), row("t4", null)]);
    expect(out.map((r) => r.stripe_payment_intent_id)).toEqual(["ch_1", "ch_2", null, null]);
  });
});

describe("chargeIdsIn", () => {
  it("lists each id once, ignoring the rows with none", () => {
    expect(chargeIdsIn([row("t1", "ch_1"), row("t2", "ch_1"), row("t3", null)])).toEqual(["ch_1"]);
  });
});
