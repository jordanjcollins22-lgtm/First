"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { parseDollars } from "@/lib/job-receipts";

export type ReceiptResult = { ok: true } | { ok: false; message: string };

/**
 * A receipt for something bought for this job: the image is already in the
 * job's folder of the job-photos bucket; this records what it was for and
 * what it cost.
 */
export async function addJobReceipt(jobId: string, path: string, what: string, amount: string): Promise<ReceiptResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!path.startsWith(`${jobId}/receipt-`)) return { ok: false, message: "That receipt doesn't belong to this job." };
  const said = what.trim();
  if (!said) return { ok: false, message: "Say what you bought." };
  const amountCents = amount.trim() ? parseDollars(amount) : null;
  if (amount.trim() && amountCents == null) return { ok: false, message: "The amount should look like 12.50." };

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { error } = await supabase.from("job_receipts").insert({
    organization_id: organizationId,
    job_id: jobId,
    path,
    what: said.slice(0, 300),
    amount_cents: amountCents,
    uploaded_by: profile.id,
  });
  if (error) return { ok: false, message: "Couldn't save the receipt. Try again." };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work-order`);
  return { ok: true };
}
