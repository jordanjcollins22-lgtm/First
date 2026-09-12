import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invoice a client actually receives.
 *
 * A real client was sent a bill for nothing: the code made a pending invoice
 * item, then an invoice, and expected the second to sweep up the first.
 * Stripe's `pending_invoice_items_behavior` defaults to "exclude", so the
 * invoice was finalized with no lines on it at all, at zero, and sent — while
 * the item sat pending on the customer and the job stayed unbilled.
 *
 * Nothing about that was visible from the outside: the amount we asked for and
 * the amount we recorded were both right, and only the invoice in between was
 * wrong. So these tests watch what is said to Stripe.
 */

const stripe = {
  customers: { create: vi.fn(), list: vi.fn() },
  invoices: {
    create: vi.fn(),
    retrieve: vi.fn(),
    finalizeInvoice: vi.fn(),
    del: vi.fn(),
  },
  invoiceItems: { create: vi.fn() },
};

const inserted: { table: string; row: Record<string, unknown> }[] = [];

// A class, not a mock function: `clearAllMocks` between tests would strip a
// mocked constructor's implementation and every later test would fail on
// "stripe is not a constructor" rather than on what it was checking.
vi.mock("stripe", () => ({
  default: class {
    constructor() {
      return stripe as never;
    }
  },
}));
vi.mock("@/lib/env", () => ({ env: { stripeSecretKey: "sk_test_x" }, isStripeConfigured: true }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn(async () => {}), toE164: () => null }));
vi.mock("@/lib/stripe-customer", () => ({
  stripeCustomerFor: vi.fn(async () => "cus_existing"),
  stripeClient: () => stripe,
}));
vi.mock("@/lib/job-customer", () => ({
  getJobCustomerContact: vi.fn(async () => ({
    customerId: "contact-1",
    customerName: "Matthew",
    email: "matthew@example.com",
    phone: null,
    organizationId: "org-1",
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "jobs" ? { data: { name: "Trellis Lane" } } : { data: null },
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));

const { createAndSendInvoice } = await import("@/lib/invoicing");

/** A Stripe that behaves: the draft prices up once the line is added. */
function stripeThatPrices(totalCents: number) {
  stripe.invoices.create.mockResolvedValue({ id: "in_1" });
  stripe.invoices.del.mockResolvedValue({ id: "in_1", deleted: true });
  stripe.invoices.retrieve.mockResolvedValue({ id: "in_1", total: totalCents });
  stripe.invoices.finalizeInvoice.mockResolvedValue({
    id: "in_1",
    hosted_invoice_url: "https://pay.example/in_1",
    invoice_pdf: "https://pay.example/in_1.pdf",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
});

describe("billing a job", () => {
  it("puts the line on the invoice instead of leaving it pending", () => {
    stripeThatPrices(31_500);
    return createAndSendInvoice("job-1", "prop-1", 315).then(() => {
      const item = stripe.invoiceItems.create.mock.calls[0][0];
      // The whole bug in one assertion. Without this the item is pending on
      // the customer and the invoice goes out empty.
      expect(item.invoice).toBe("in_1");
      expect(item.amount).toBe(31_500);
    });
  });

  it("makes the invoice before the line, so there is something to attach it to", async () => {
    stripeThatPrices(31_500);
    await createAndSendInvoice("job-1", "prop-1", 315);
    expect(stripe.invoices.create.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.invoiceItems.create.mock.invocationCallOrder[0]
    );
  });

  it("never inherits Stripe's idea of what to do with pending items", async () => {
    // A default that has already changed once is a default worth stating.
    stripeThatPrices(31_500);
    await createAndSendInvoice("job-1", "prop-1", 315);
    expect(stripe.invoices.create.mock.calls[0][0].pending_invoice_items_behavior).toBe("exclude");
  });

  it("sends it and writes it down once the price is right", async () => {
    stripeThatPrices(31_500);
    await createAndSendInvoice("job-1", "prop-1", 315);
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    expect(inserted.find((row) => row.table === "invoices")?.row.amount).toBe(315);
  });

  it("refuses to send a bill Stripe priced at nothing", async () => {
    // What actually happened. Caught while it is still a draft, so it never
    // reaches a client.
    stripeThatPrices(0);
    await expect(createAndSendInvoice("job-1", "prop-1", 315)).rejects.toThrow(/0 cents/);
    expect(stripe.invoices.finalizeInvoice).not.toHaveBeenCalled();
  });

  it("throws away the wrong draft rather than leaving it lying about", async () => {
    stripeThatPrices(0);
    await createAndSendInvoice("job-1", "prop-1", 315).catch(() => {});
    expect(stripe.invoices.del).toHaveBeenCalledWith("in_1");
  });

  it("records nothing when nothing was sent", async () => {
    stripeThatPrices(0);
    await createAndSendInvoice("job-1", "prop-1", 315).catch(() => {});
    expect(inserted.find((row) => row.table === "invoices")).toBeUndefined();
  });

  it("refuses a bill for any amount other than the one asked for", async () => {
    stripeThatPrices(31_400);
    await expect(createAndSendInvoice("job-1", "prop-1", 315)).rejects.toThrow(/31400 cents/);
  });

  it("does nothing at all for an amount of nothing", async () => {
    await createAndSendInvoice("job-1", "prop-1", 0);
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });
});
