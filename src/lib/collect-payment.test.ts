import { describe, expect, it } from "vitest";

import { awaitingLine, collectEmail, collectedThreadNote, isOfflineMethod, offlineConfirmation, offlineThreadNote } from "./collect-payment";

describe("collect-payment", () => {
  it("tells the client who is coming and for how much", () => {
    expect(offlineConfirmation("check", 65000, "Jace")).toBe(
      "Got it. Jace will arrange to collect $650.00 by check. Next, pick the day you would like us."
    );
    expect(offlineConfirmation("cash", 65000, null)).toContain("Your account manager will arrange to collect $650.00 by cash");
  });

  it("writes the account manager an email with everything needed", () => {
    const mail = collectEmail({
      clientName: "Jill Latteri",
      amountCents: 65000,
      method: "check",
      address: "439 Oakton Way, Abingdon, MD 21009",
      phone: "(425) 246-2611",
      jobUrl: "https://app.jslandscapingmd.com/jobs/abc",
      managerFirstName: "Jace",
    });
    expect(mail.subject).toBe("Jill Latteri wants to pay $650.00 by check");
    expect(mail.text).toContain("Jace, Jill Latteri just signed and chose to pay by check instead of card.");
    expect(mail.text).toContain("Amount: $650.00");
    expect(mail.text).toContain("Address: 439 Oakton Way, Abingdon, MD 21009");
    expect(mail.text).toContain("Phone: (425) 246-2611");
    expect(mail.text).toContain("https://app.jslandscapingmd.com/jobs/abc");
  });

  it("leaves out what it does not know", () => {
    const mail = collectEmail({ clientName: "A", amountCents: 100, method: "cash", address: null, phone: null, jobUrl: "u", managerFirstName: null });
    expect(mail.text).not.toContain("Address:");
    expect(mail.text).not.toContain("Phone:");
    expect(mail.text.startsWith("A just signed")).toBe(true);
  });

  it("names the method plainly on the thread and the card", () => {
    expect(offlineThreadNote("check", 65000)).toBe("Chose to pay $650.00 by check. To be collected by the account manager.");
    expect(collectedThreadNote("cash", 65000, "Jace")).toBe("$650.00 received by cash. Picked up by Jace.");
    expect(awaitingLine("check", "2026-09-15T12:00:00Z", () => "Sep 15")).toBe("Client asked to pay by check on Sep 15. Collect it and mark it here.");
    expect(awaitingLine("check", null, () => "")).toBe("Client asked to pay by check. Collect it and mark it here.");
  });

  it("only knows cash and check", () => {
    expect(isOfflineMethod("cash")).toBe(true);
    expect(isOfflineMethod("card")).toBe(false);
  });
});
