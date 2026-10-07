"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public quote portal actions. The RFQ token in the link is the only
 * credential, so every action looks it up and refuses closed RFQs.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024; // matches serverActions.bodySizeLimit

async function openRfq(token: string) {
  const db = createAdminClient();
  const { data: rfq } = await db.from("govcon_rfqs").select("*").eq("token", token).maybeSingle();
  if (!rfq) throw new Error("This quote link is invalid.");
  if (rfq.quote_due_at && Date.parse(rfq.quote_due_at) < Date.now() - 86_400_000) {
    throw new Error("The quote window for this job has closed.");
  }
  return { db, rfq };
}

export interface QuoteFormState {
  ok?: boolean;
  error?: string;
}

export async function submitQuote(token: string, _prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  try {
    await saveQuote(token, formData);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function saveQuote(token: string, formData: FormData) {
  const { db, rfq } = await openRfq(token);
  const amount = Number(String(formData.get("amount") ?? "").replace(/[$,\s]/g, ""));
  if (!(amount > 0)) throw new Error("Enter your total price.");
  const yes = (k: string) => (formData.get(k) === "yes" ? true : formData.get(k) === "no" ? false : null);

  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) throw new Error("File is too large (4 MB max) — email it instead.");
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    filePath = `${rfq.opportunity_id}/${rfq.id}-${Date.now()}.${ext}`;
    const { error } = await db.storage.from("govcon-quotes").upload(filePath, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  }

  const quote = {
    rfq_id: rfq.id,
    opportunity_id: rfq.opportunity_id,
    subcontractor_id: rfq.subcontractor_id,
    amount,
    notes: String(formData.get("notes") ?? "").slice(0, 10_000) || null,
    lead_time: String(formData.get("lead_time") ?? "").slice(0, 500) || null,
    accepts_net30: yes("net30"),
    down_payment_pct: Number(formData.get("down_payment_pct")) || null,
    uses_own_employees: yes("own_employees"),
    is_small_business: yes("small_business"),
    uei: String(formData.get("uei") ?? "").trim().slice(0, 20) || null,
    contact_name: String(formData.get("contact_name") ?? "").slice(0, 200) || null,
    contact_email: String(formData.get("contact_email") ?? "").slice(0, 200) || null,
    contact_phone: String(formData.get("contact_phone") ?? "").slice(0, 50) || null,
    references_text: String(formData.get("references") ?? "").slice(0, 5_000) || null,
    file_path: filePath,
    compliance: null,
  };
  // Re-submitting replaces the earlier quote.
  await db.from("govcon_quotes").delete().eq("rfq_id", rfq.id);
  const { error } = await db.from("govcon_quotes").insert(quote);
  if (error) throw new Error("Could not save your quote — please try again.");
  await db.from("govcon_rfqs").update({ status: "quoted" }).eq("id", rfq.id);
  if (quote.uei || quote.is_small_business !== null) {
    await db.from("govcon_subcontractors").update({ uei: quote.uei, is_small_business: quote.is_small_business }).eq("id", rfq.subcontractor_id);
  }
  await db.from("govcon_events").insert({ opportunity_id: rfq.opportunity_id, kind: "quote", message: `Quote received via portal: $${amount.toLocaleString()}` });
  revalidatePath(`/quote/${token}`);
}

export async function declineQuote(token: string) {
  const { db, rfq } = await openRfq(token);
  await db.from("govcon_rfqs").update({ status: "declined" }).eq("id", rfq.id);
  await db.from("govcon_events").insert({ opportunity_id: rfq.opportunity_id, kind: "declined", message: "A sub declined to quote" });
  revalidatePath(`/quote/${token}`);
}
