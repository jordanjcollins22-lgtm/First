import { describe, expect, it } from "vitest";

import {
  describeChanges,
  mergeContact,
  modeBlurb,
  modeLabel,
  type ExistingContact,
  type IncomingContact,
} from "./contact-merge";

const EXISTING: ExistingContact = {
  email: "jo@example.com",
  phone: "410 555 0000",
  external_id: "ghl-1",
  import_address: "1 Wrong Street, Towson, MD 21204",
  notes: "Prefers mornings",
  source: "Referral",
  pipeline: "Landscaping",
  pipeline_stage: "Proposal Sent",
  opportunity_value: 5000,
  do_not_contact: false,
  tags: ["Client"],
};

function incoming(over: Partial<IncomingContact> = {}): IncomingContact {
  return {
    email: null,
    phone: null,
    externalId: null,
    address: null,
    notes: null,
    source: null,
    pipeline: null,
    pipelineStage: null,
    opportunityValue: null,
    doNotContact: false,
    tags: [],
    ...over,
  };
}

const BLANK: ExistingContact = {
  email: null,
  phone: null,
  external_id: null,
  import_address: null,
  notes: null,
  source: null,
  pipeline: null,
  pipeline_stage: null,
  opportunity_value: null,
  do_not_contact: false,
  tags: null,
};

describe("the rule everything rests on", () => {
  it("never clears a field because the export left the column blank", () => {
    // A CRM export without a phone column is not a statement that nobody has
    // a phone number. Treating it as one wipes the contact book in a click.
    for (const mode of ["fill", "overwrite"] as const) {
      expect(mergeContact(EXISTING, incoming(), mode)).toEqual({});
    }
  });

  it("ignores a column that is only whitespace", () => {
    const patch = mergeContact(EXISTING, incoming({ address: "   " }), "overwrite");
    expect(patch.import_address).toBeUndefined();
  });
});

describe("fill mode", () => {
  it("adds what is missing", () => {
    const patch = mergeContact(BLANK, incoming({ address: "2 Right Rd, Bel Air, MD 21014" }), "fill");
    expect(patch.import_address).toBe("2 Right Rd, Bel Air, MD 21014");
  });

  it("leaves a wrong value exactly where it is", () => {
    // The reason overwrite mode had to exist. A corrected export changes
    // nothing here, because the field was not blank, it was wrong.
    const patch = mergeContact(EXISTING, incoming({ address: "2 Right Rd, Bel Air, MD 21014" }), "fill");
    expect(patch.import_address).toBeUndefined();
  });

  it("does not touch anything a person typed here", () => {
    const patch = mergeContact(EXISTING, incoming({ notes: "From the CRM", phone: "111" }), "fill");
    expect(patch.notes).toBeUndefined();
    expect(patch.phone).toBeUndefined();
  });
});

describe("overwrite mode", () => {
  it("corrects a wrong address", () => {
    const patch = mergeContact(
      EXISTING,
      incoming({ address: "2 Right Rd, Bel Air, MD 21014" }),
      "overwrite"
    );
    expect(patch.import_address).toBe("2 Right Rd, Bel Air, MD 21014");
  });

  it("says nothing when the two already agree", () => {
    // An import that reports three thousand updates it did not make is an
    // import nobody can check.
    const patch = mergeContact(EXISTING, incoming({ address: EXISTING.import_address }), "overwrite");
    expect(patch).toEqual({});
  });

  it("still fills blanks", () => {
    expect(mergeContact(BLANK, incoming({ email: "new@example.com" }), "overwrite").email).toBe(
      "new@example.com"
    );
  });

  it("updates a changed opportunity value but not an unchanged one", () => {
    expect(mergeContact(EXISTING, incoming({ opportunityValue: 9000 }), "overwrite").opportunity_value).toBe(9000);
    expect(mergeContact(EXISTING, incoming({ opportunityValue: 5000 }), "overwrite").opportunity_value).toBeUndefined();
  });
});

describe("do not contact", () => {
  it("is set by either mode", () => {
    for (const mode of ["fill", "overwrite"] as const) {
      expect(mergeContact(EXISTING, incoming({ doNotContact: true }), mode).do_not_contact).toBe(true);
    }
  });

  it("is never unset by an export that forgot", () => {
    // Somebody who asked not to be contacted does not stop having asked.
    const patch = mergeContact(EXISTING, incoming({ doNotContact: false }), "overwrite");
    expect(patch.do_not_contact).toBeUndefined();
  });

  it("is not written again to somebody who is already opted out", () => {
    // Re-importing an export where everybody has opted out would otherwise
    // report every row as changed and rewrite every row to say what it
    // already said.
    const optedOut = { ...EXISTING, do_not_contact: true };
    expect(mergeContact(optedOut, incoming({ doNotContact: true }), "overwrite")).toEqual({});
  });
});

describe("tags", () => {
  it("takes the file's tags when they are new", () => {
    expect(mergeContact(EXISTING, incoming({ tags: ["Client", "Snow"] }), "overwrite").tags).toEqual([
      "Client",
      "Snow",
    ]);
  });

  it("says nothing when the file's tags are the ones already filed", () => {
    expect(mergeContact(EXISTING, incoming({ tags: ["Client"] }), "overwrite")).toEqual({});
  });

  it("does not clear tags because the export had no tag column", () => {
    expect(mergeContact(EXISTING, incoming({ tags: [] }), "overwrite").tags).toBeUndefined();
  });
});

describe("describeChanges", () => {
  it("shows both values for a real replacement", () => {
    const next = "2 Right Rd, Bel Air, MD 21014";
    const patch = mergeContact(EXISTING, incoming({ address: next }), "overwrite");
    expect(describeChanges(EXISTING, patch)).toEqual([
      { label: "Address", from: EXISTING.import_address, to: next },
    ]);
  });

  it("says nothing about filling a blank", () => {
    // Nobody needs to review an empty field being filled in.
    const patch = mergeContact(BLANK, incoming({ email: "a@b.com" }), "fill");
    expect(describeChanges(BLANK, patch)).toEqual([]);
  });

  it("lists every field that changed", () => {
    const patch = mergeContact(
      EXISTING,
      incoming({ address: "2 Right Rd", phone: "410 555 1111" }),
      "overwrite"
    );
    expect(describeChanges(EXISTING, patch).map((c) => c.label).sort()).toEqual(["Address", "Phone"]);
  });
});

describe("the wording on the choice", () => {
  it("says which one does what", () => {
    expect(modeLabel("fill")).toMatch(/never seen/i);
    expect(modeLabel("overwrite")).toMatch(/update the ones we already have/i);
  });

  it("promises a blank column will not clear anything", () => {
    expect(modeBlurb("overwrite")).toMatch(/never clears anything/i);
  });

  it("uses no dashes", () => {
    for (const mode of ["fill", "overwrite"] as const) {
      expect(`${modeLabel(mode)} ${modeBlurb(mode)}`).not.toMatch(/[—–]/);
    }
  });
});
