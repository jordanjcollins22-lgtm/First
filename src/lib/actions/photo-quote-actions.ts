"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { v2RolesOf } from "@/lib/v2-roles";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { outboundBaseUrl } from "@/lib/base-url";
import { visitLinkMessage } from "@/lib/photo-quote";
import { log } from "@/lib/log";

/**
 * What the office does with a photo quote that has come in: say it needs a
 * visit (the client is sent a link to pick a time), or mark it priced.
 * Pricing itself is the site map and proposal every job already uses.
 *
 * Owner or account manager, checked against who is really signed in, and
 * every read is the signed-in person's own row security.
 */

export type PhotoQuoteResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The photo-quote columns are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

async function photoQuote(jobId: string) {
  const me = await getRealProfile();
  if (!me) return { error: "Sign in first." } as const;
  if (!isOwnerLevel(me.roles) && !v2RolesOf(me).includes("account-manager")) return { error: "That isn't something your role can change." } as const;
  if (!UUID.test(jobId)) return { error: "That photo quote isn't there any more." } as const;
  const supabase = await createClient();
  const { data } = await untyped(supabase)
    .from("evaluation_intakes")
    .select("id, photo_quote, job:jobs!inner(id, property:properties!inner(customer:customers!inner(name, organization_id)))")
    .eq("job_id", jobId)
    .eq("organization_id", me.organization_id)
    .maybeSingle();
  const row = data as { id: string; photo_quote: boolean; job: { property: { customer: { name: string | null } } } } | null;
  if (!row?.photo_quote) return { error: "That photo quote isn't there any more." } as const;
  return { supabase, organizationId: me.organization_id, intakeId: row.id, clientName: row.job.property.customer.name } as const;
}

async function settle(supabase: SupabaseClient, intakeId: string, outcome: "priced" | "visit") {
  const { error } = await untyped(supabase)
    .from("evaluation_intakes")
    .update({ photo_quote_outcome: outcome, photo_quote_outcome_at: new Date().toISOString() })
    .eq("id", intakeId);
  return error;
}

function refresh(jobId: string) {
  revalidatePath("/v2", "layout");
  revalidatePath(`/jobs/${jobId}`);
}

/**
 * "Needs a visit": the client is sent the booking link, on the job's thread,
 * the way the office's own messages go (email when it can, a text when it
 * can't), and the quote leaves the waiting list. When they pick a time the
 * visit lands on this same job, photos and all.
 */
export async function askForVisit(jobId: string): Promise<PhotoQuoteResult> {
  const found = await photoQuote(jobId);
  if ("error" in found) return { ok: false, error: found.error ?? "Couldn't do that." };
  try {
    const { data: org } = await found.supabase.from("organizations").select("slug").eq("id", found.organizationId).maybeSingle();
    const query = new URLSearchParams();
    if (org?.slug) query.set("org", org.slug);
    query.set("visit", "1");
    const link = `${await outboundBaseUrl()}/book?${query.toString()}`;
    await postJobMessage(jobId, "external", visitLinkMessage({ clientName: found.clientName, link }));
    const error = await settle(found.supabase, found.intakeId, "visit");
    if (error) return { ok: false, error: error.message };
    log.info("photo_quote.visit_asked", { jobId });
    refresh(jobId);
    return { ok: true, message: "Sent them a link to pick a time. The visit goes on this job, with their photos." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the link." };
  }
}

/** Priced another way (on the phone, by hand): off the waiting list. */
export async function markPhotoQuotePriced(jobId: string): Promise<PhotoQuoteResult> {
  const found = await photoQuote(jobId);
  if ("error" in found) return { ok: false, error: found.error ?? "Couldn't do that." };
  const error = await settle(found.supabase, found.intakeId, "priced");
  if (error) return { ok: false, error: error.message };
  refresh(jobId);
  return { ok: true, message: "Marked priced." };
}
