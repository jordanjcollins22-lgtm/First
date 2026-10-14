import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn(), toE164: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

import { withJobContext } from "@/lib/notifications";

const james = { name: "James Campbell", address: "177 Campus Lakes Court, Bel Air, Maryland 21015, United States", jobNumber: 82 };

describe("withJobContext", () => {
  it("says who accepted, where, and which job", () => {
    expect(withJobContext("A client accepted their proposal.", james)).toBe(
      "James Campbell accepted their proposal.\n177 Campus Lakes Court, Bel Air · Job #82"
    );
  });

  it("names the client in front when the message names nobody", () => {
    expect(withJobContext("Dispute opened on a job.", james)).toMatch(/^James Campbell: Dispute opened/);
  });

  it("does not name them twice", () => {
    expect(withJobContext("James Campbell replied: thanks", james)).toBe("James Campbell replied: thanks\n177 Campus Lakes Court, Bel Air · Job #82");
  });

  it("leaves the message alone when the job cannot be found", () => {
    expect(withJobContext("A client accepted their proposal.", null)).toBe("A client accepted their proposal.");
  });
});
