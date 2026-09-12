"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { canIssue, nextSequence, receiptNumber, type PaymentMethod, type Receipt } from "@/lib/receipt";

/**
 * Writing a receipt, and handing it over.
 *
 * A receipt is written once, numbered once, and the number is never reused,
 * because a client keeps it and a bookkeeper files by it. Issuing is the
 * only write that matters; everything after is reading it back.
 *
 * Two sides, like every other document a client holds. The office side runs
 * as the signed-in person and is gated on the roles that run the money. The
 * client side runs on the service role, because the person holding the
 * receipt has no account and the token in their link is the whole of their
 * access.
 */

export type ReceiptResult =
  | { ok: true; token: string; number: string }
  | { ok: false; message: string };

async function allowed(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return Boolean(profile?.roles.includes("admin") || profile?.roles.includes("overhead"));
}

/** Long enough that guessing is not a strategy, short enough to text. */
function mintToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Write the receipt for one payment.
 *
 * Idempotent: a payment that already has one hands it back rather than
 * writing a second, so pressing the button twice cannot produce two numbers
 * for one cheque. The number is claimed with a conditional update and
 * retried on a clash, which is what makes two people issuing at once safe
 * without a lock.
 */
export async function issueReceipt(paymentId: string): Promise<ReceiptResult> {
  if (!(await allowed())) return { ok: false, message: "Only whoever runs the money can write receipts." };

  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, organization_id, amount_cents, received_at, receipt_number, receipt_token")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { ok: false, message: "That payment is not here." };

  if (payment.receipt_number && payment.receipt_token) {
    return { ok: true, token: payment.receipt_token, number: payment.receipt_number };
  }
  if (!canIssue({ amountCents: payment.amount_cents, receivedAt: payment.received_at })) {
    return { ok: false, message: "A receipt is for money that arrived. This one has no amount or no date." };
  }

  const year = new Date(payment.received_at).getFullYear();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: issued } = await supabase
      .from("payments")
      .select("receipt_number")
      .eq("organization_id", payment.organization_id)
      .like("receipt_number", `R-${year}-%`);

    const number = receiptNumber(
      year,
      nextSequence((issued ?? []).map((row) => row.receipt_number ?? ""), year)
    );
    const token = mintToken();

    const { data: claimed, error } = await supabase
      .from("payments")
      .update({
        receipt_number: number,
        receipt_token: token,
        receipt_issued_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .is("receipt_number", null)
      .select("receipt_number, receipt_token")
      .maybeSingle();

    if (claimed?.receipt_number && claimed.receipt_token) {
      revalidatePath("/admin/payments");
      return { ok: true, token: claimed.receipt_token, number: claimed.receipt_number };
    }
    // A unique clash means somebody else took that number a moment ago. Read
    // again and take the next one. Anything else is a real failure.
    if (error && !/duplicate|unique/i.test(error.message)) {
      return { ok: false, message: error.message };
    }
    if (!error) {
      // No error and no row: somebody issued it between our read and our
      // write. Hand back what they wrote.
      const { data: theirs } = await supabase
        .from("payments")
        .select("receipt_number, receipt_token")
        .eq("id", payment.id)
        .maybeSingle();
      if (theirs?.receipt_number && theirs.receipt_token) {
        return { ok: true, token: theirs.receipt_token, number: theirs.receipt_number };
      }
    }
  }
  return { ok: false, message: "Could not claim a receipt number. Try once more." };
}

/** Noted as sent, so the list can say which clients have theirs. */
export async function markReceiptSent(paymentId: string): Promise<{ ok: boolean; message?: string }> {
  if (!(await allowed())) return { ok: false, message: "Only whoever runs the money can do that." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("payments")
    .update({ receipt_sent_at: new Date().toISOString() })
    .eq("id", paymentId)
    .not("receipt_number", "is", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/payments");
  return { ok: true };
}

/**
 * The receipt, for the person holding the link.
 *
 * Built fresh from the payment and what sits around it rather than stored
 * as text, so a client re-opening it after the office corrected a name sees
 * the correction. What is fixed is the number and the money; everything
 * else is read.
 *
 * The outstanding balance is worked out only when the job has a proposal
 * total to work it out from. Otherwise it is left null and the page says
 * nothing about a balance, because a receipt that prints "$0 outstanding"
 * on a job nobody has totalled tells the client they are paid up.
 */
export async function receiptByToken(token: string): Promise<Receipt | null> {
  if (!token || token.length < 8) return null;
  const admin = createAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select(
      "id, organization_id, customer_id, job_id, amount_cents, surcharge_cents, method, received_at, note, payer_name, stripe_invoice_id, receipt_number"
    )
    .eq("receipt_token", token)
    .maybeSingle();
  if (!payment || !payment.receipt_number) return null;

  const [{ data: org }, { data: customer }, { data: job }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, business_phone, business_email, business_address, business_website, logo_path")
      .eq("id", payment.organization_id)
      .maybeSingle(),
    payment.customer_id
      ? admin.from("customers").select("name").eq("id", payment.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    payment.job_id
      ? admin
          .from("jobs")
          .select("name, property:properties(address)")
          .eq("id", payment.job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let outstandingCents: number | null = null;
  if (payment.job_id) {
    const [{ data: proposal }, { data: paid }] = await Promise.all([
      admin.from("job_proposals").select("total_cost").eq("job_id", payment.job_id).maybeSingle(),
      admin
        .from("payments")
        .select("amount_cents, surcharge_cents")
        .eq("job_id", payment.job_id),
    ]);
    if (proposal?.total_cost != null) {
      const totalCents = Math.round(Number(proposal.total_cost) * 100);
      // What the work was paid, fee excluded. The card fee is not money
      // against the job; counting it would say a client had overpaid.
      const workPaid = (paid ?? []).reduce(
        (sum, row) => sum + (row.amount_cents - (row.surcharge_cents ?? 0)),
        0
      );
      outstandingCents = totalCents - workPaid;
    }
  }

  const property = (job as { property?: { address?: string } | null } | null)?.property;
  const method = (["cash", "check", "card", "transfer", "other"] as PaymentMethod[]).includes(
    payment.method as PaymentMethod
  )
    ? (payment.method as PaymentMethod)
    : "other";

  return {
    number: payment.receipt_number,
    amountCents: payment.amount_cents,
    receivedAt: payment.received_at,
    method,
    payerName: customer?.name ?? payment.payer_name ?? null,
    forWhat: (job as { name?: string } | null)?.name ?? null,
    address: property?.address ?? null,
    businessName: org?.name ?? "",
    business: {
      phone: org?.business_phone ?? null,
      email: org?.business_email ?? null,
      address: org?.business_address ?? null,
      website: org?.business_website ?? null,
      logoUrl: org?.logo_path ?? null,
    },
    reference: payment.stripe_invoice_id ?? null,
    note: payment.note,
    outstandingCents,
  };
}
