import { describe, expect, it } from "vitest";
import { buildNewLeadEmail, type NewLeadDetails } from "./new-lead-email";

const base: NewLeadDetails = {
  name: "Nick Kraemer",
  phone: "410-555-0100",
  email: "nick@example.com",
  address: "12 Main St, Bel Air, MD 21014, USA",
  source: "Tracked link abc123",
  referrer: "Patricia's link (facebook)",
  heardAbout: "friend",
  heardAboutDetail: null,
  kind: "lead",
  visitWhen: null,
  services: ["Mulch", "Leaf removal"],
  budgetRange: null,
  notes: null,
  returningClient: false,
  clientUrl: "https://app.jslandscapingmd.com/clients/c1",
  managerFirstName: "Jace",
};

describe("buildNewLeadEmail", () => {
  it("puts the name, address, phone, source, referrer and client link in", () => {
    const mail = buildNewLeadEmail(base);
    expect(mail.subject).toBe("New lead: Nick Kraemer, 12 Main St, Bel Air");
    expect(mail.text).toContain("Hi Jace,");
    expect(mail.text).toContain("Phone: 410-555-0100");
    expect(mail.text).toContain("Address: 12 Main St, Bel Air, MD 21014, USA");
    expect(mail.text).toContain("Came from: Tracked link abc123");
    expect(mail.text).toContain("Referrer: Patricia's link (facebook)");
    expect(mail.text).toContain("Heard about us: Friend or neighbor");
    expect(mail.text).toContain("Wants: Mulch, Leaf removal");
    expect(mail.text).toContain("Open the client: https://app.jslandscapingmd.com/clients/c1");
  });

  it("says when a visit is booked and leaves out what's blank", () => {
    const mail = buildNewLeadEmail({ ...base, kind: "visit", visitWhen: "Mon, Dec 1, 9:00 AM", referrer: null, heardAbout: null, services: [] });
    expect(mail.text).toContain("booked an estimate visit for Mon, Dec 1, 9:00 AM");
    expect(mail.text).not.toContain("Referrer:");
    expect(mail.text).not.toContain("Wants:");
    expect(mail.text).not.toContain("Budget:");
  });
});
