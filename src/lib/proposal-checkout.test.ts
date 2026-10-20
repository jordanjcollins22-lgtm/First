import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/env", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/base-url", () => ({ outboundBaseUrl: async () => "https://app.example.com" }));
vi.mock("@/lib/job-customer", () => ({ getJobCustomerContact: async () => ({ customerId: null, email: "a@b.co" }) }));
vi.mock("@/lib/stripe-customer", () => ({
  stripeClient: () => ({ checkout: { sessions: { create } } }),
  stripeCustomerFor: async () => null,
}));

import { startProposalCheckout } from "@/lib/proposal-checkout";

const base = { token: "t", jobId: "j", proposalId: "p", organizationId: "o", amountCents: 63200, description: "Balance" };

describe("a proposal checkout with a tip", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ url: "https://checkout.stripe.com/x", id: "cs_1" });
  });

  it("puts the tip on its own line and in the metadata, apart from the work", async () => {
    await startProposalCheckout({ ...base, tipCents: 9500 });
    const args = create.mock.calls[0][0];
    const tipLine = args.line_items.find((l: { price_data: { product_data: { name: string } } }) => l.price_data.product_data.name === "Tip for the crew");
    expect(tipLine.price_data.unit_amount).toBe(9500);
    expect(args.metadata.tip_cents).toBe("9500");
    expect(args.metadata.work_cents).toBe("63200");
  });

  it("has no tip line when there is no tip", async () => {
    await startProposalCheckout(base);
    const args = create.mock.calls[0][0];
    expect(args.line_items.some((l: { price_data: { product_data: { name: string } } }) => l.price_data.product_data.name === "Tip for the crew")).toBe(false);
    expect(args.metadata.tip_cents).toBeUndefined();
  });
});
