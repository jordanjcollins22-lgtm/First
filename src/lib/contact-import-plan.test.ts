import { describe, expect, it } from "vitest";

import type { ContactDraft } from "./contact-import";
import { planContactImport, type ExistingContactRow } from "./contact-import-plan";

const ORG = "org-1";

function draft(over: Partial<ContactDraft> = {}): ContactDraft {
  return {
    name: "Jo Fisher",
    email: null,
    phone: null,
    address: null,
    tags: [],
    source: null,
    externalId: null,
    doNotContact: false,
    notes: null,
    pipeline: null,
    pipelineStage: null,
    opportunityValue: null,
    ...over,
  };
}

function existing(over: Partial<ExistingContactRow> = {}): ExistingContactRow {
  return {
    id: "contact-1",
    organization_id: ORG,
    name: "Jo Fisher",
    email: "jo@example.com",
    phone: "410 555 0000",
    external_id: "ghl-1",
    import_address: "1 Wrong Street, Towson, MD 21204",
    notes: null,
    source: null,
    pipeline: null,
    pipeline_stage: null,
    opportunity_value: null,
    do_not_contact: false,
    tags: null,
    ...over,
  };
}

const OVERWRITE = { mode: "overwrite" as const, organizationId: ORG };

describe("people the book has never seen", () => {
  it("plans one insert carrying what the file said about them", () => {
    const plan = planContactImport([], [draft({ name: "New Person", email: "new@example.com" })], OVERWRITE);

    expect(plan.created).toBe(1);
    expect(plan.updated).toBe(0);
    expect(plan.inserts).toEqual([
      expect.objectContaining({ organization_id: ORG, name: "New Person", email: "new@example.com" }),
    ]);
  });

  it("collapses two rows about the same person into one insert", () => {
    // The parser only drops a repeat when both rows carry the same
    // identifier, so somebody listed once with an email and once with a phone
    // arrives as two rows about one person. Writing them one at a time used
    // to hide that, because the second row could see what the first had just
    // written.
    const plan = planContactImport(
      [],
      [
        draft({ name: "Sam Reed", email: "sam@example.com" }),
        draft({ name: "Sam Reed", phone: "410 555 1234" }),
      ],
      OVERWRITE
    );

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ email: "sam@example.com", phone: "410 555 1234" });
    expect(plan.updates).toEqual([]);
  });
});

describe("people who are already here", () => {
  it("finds them by the CRM's own id and rewrites rather than adding", () => {
    const plan = planContactImport(
      [existing()],
      [draft({ externalId: "ghl-1", name: "Different Spelling", address: "2 Right Rd, Bel Air, MD 21014" })],
      OVERWRITE
    );

    expect(plan.inserts).toEqual([]);
    expect(plan.updated).toBe(1);
    expect(plan.updates[0].row.id).toBe("contact-1");
    expect(plan.updates[0].row.import_address).toBe("2 Right Rd, Bel Air, MD 21014");
  });

  it("sends back the value already on the contact where the file's column is blank", () => {
    // The whole reason the rewrite can safely be a whole row. A file with no
    // phone column is not a statement that nobody has a phone number, so the
    // number that is already there is what gets written.
    const plan = planContactImport(
      [existing()],
      [draft({ externalId: "ghl-1", address: "2 Right Rd, Bel Air, MD 21014" })],
      OVERWRITE
    );

    expect(plan.updates[0].row).toMatchObject({
      phone: "410 555 0000",
      email: "jo@example.com",
      name: "Jo Fisher",
    });
  });

  it("leaves a contact out of the write entirely when the file adds nothing", () => {
    const plan = planContactImport([existing()], [draft({ externalId: "ghl-1" })], OVERWRITE);

    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("keeps an opt-out the export forgot to carry", () => {
    const plan = planContactImport(
      [existing({ do_not_contact: true })],
      [draft({ externalId: "ghl-1", doNotContact: false, notes: "Called Tuesday" })],
      OVERWRITE
    );

    expect(plan.updates[0].row.do_not_contact).toBe(true);
  });

  it("never plans two writes for the same contact", () => {
    // An upsert that names the same row twice in one statement is an error,
    // not a last-one-wins — so a file that reaches the same person by two
    // different doors has to be merged before it is sent.
    const plan = planContactImport(
      [existing({ import_address: null, notes: null })],
      [
        draft({ email: "jo@example.com", address: "2 Right Rd, Bel Air, MD 21014" }),
        draft({ phone: "410 555 0000", notes: "Gate code 4110" }),
      ],
      OVERWRITE
    );

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].row).toMatchObject({
      import_address: "2 Right Rd, Bel Air, MD 21014",
      notes: "Gate code 4110",
    });
  });
});

describe("addresses that moved", () => {
  it("flags the ones to send back through the geocoder", () => {
    // A corrected address that keeps its old coordinates is worse than no
    // address: every map and every out-of-area check still points at the
    // place the import was meant to fix.
    const plan = planContactImport(
      [existing({ id: "a" }), existing({ id: "b", external_id: "ghl-2", email: "b@example.com" })],
      [
        draft({ externalId: "ghl-1", address: "2 Right Rd, Bel Air, MD 21014" }),
        draft({ externalId: "ghl-2", notes: "Prefers text" }),
      ],
      OVERWRITE
    );

    const flagged = Object.fromEntries(plan.updates.map((u) => [u.row.id, u.addressChanged]));
    expect(flagged).toEqual({ a: true, b: false });
  });

  it("does not flag an address the file merely repeats", () => {
    const plan = planContactImport(
      [existing()],
      [draft({ externalId: "ghl-1", address: "1 Wrong Street, Towson, MD 21204", notes: "New note" })],
      OVERWRITE
    );

    expect(plan.updates[0].addressChanged).toBe(false);
  });
});

describe("the counts somebody reads afterwards", () => {
  it("counts contacts rather than rows", () => {
    const plan = planContactImport(
      [existing()],
      [
        draft({ externalId: "ghl-1", address: "2 Right Rd, Bel Air, MD 21014" }),
        draft({ externalId: "ghl-9", name: "Brand New", email: "brand@example.com" }),
        draft({ externalId: "ghl-1" }),
      ],
      OVERWRITE
    );

    expect(plan).toMatchObject({ created: 1, updated: 1, unchanged: 1 });
  });

  it("reports every row of the file so a preview can show what it read", () => {
    const plan = planContactImport(
      [existing()],
      [draft({ externalId: "ghl-1" }), draft({ name: "Brand New", email: "brand@example.com" })],
      OVERWRITE
    );

    expect(plan.rows.map((row) => row.outcome)).toEqual(["unchanged", "created"]);
    expect(plan.rows[0].before?.id).toBe("contact-1");
    expect(plan.rows[1].before).toBeNull();
  });
});

describe("fill mode", () => {
  it("adds what is missing and touches nothing else", () => {
    const plan = planContactImport(
      [existing({ notes: null })],
      [draft({ externalId: "ghl-1", notes: "From the CRM", address: "2 Right Rd, Bel Air, MD 21014" })],
      { mode: "fill", organizationId: ORG }
    );

    expect(plan.updates[0].row).toMatchObject({
      notes: "From the CRM",
      import_address: "1 Wrong Street, Towson, MD 21204",
    });
    expect(plan.updates[0].addressChanged).toBe(false);
  });
});
