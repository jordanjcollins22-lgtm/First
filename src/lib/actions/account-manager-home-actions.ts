"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { markConversationRead } from "@/lib/actions/conversation-read-actions";
import { isOwnerLevel, canSell } from "@/lib/roles";
import { v2RolesOf } from "@/lib/v2-roles";
import { createClient } from "@/lib/supabase/server";

/**
 * What the account manager does straight from their home screen that the
 * drawer can't: answer a client's message, and say a message is dealt with
 * (they rang instead). Both go through the actions the inbox already uses,
 * so the client's thread, the delivery and the read marker are the same.
 */

export type AmResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner, an account manager, or the office (which the new layout treats as one). */
async function accountDesk(): Promise<{ id: string; organizationId: string } | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const ok = isOwnerLevel(profile.roles) || canSell(profile.roles) || v2RolesOf(profile).includes("account-manager");
  return ok ? { id: profile.id, organizationId: profile.organization_id } : null;
}

/** Only a job in this business: the thread belongs to one of our clients. */
async function ownJob(jobId: string, organizationId: string): Promise<boolean> {
  if (!UUID.test(jobId)) return false;
  const sb = await createClient();
  const { data } = await sb
    .from("jobs")
    .select("id, property:properties!inner(customer:customers!inner(organization_id))")
    .eq("id", jobId)
    .eq("property.customer.organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
}

function refresh() {
  revalidatePath("/v2", "layout");
}

/** Reply to the client on their job's thread: email or text, whichever reaches them. */
export async function replyToClient(jobId: string, body: string): Promise<AmResult> {
  const who = await accountDesk();
  if (!who) return { ok: false, error: "Only an account manager or the owner can answer clients here." };
  const text = (body ?? "").trim();
  if (!text) return { ok: false, error: "Write the reply first." };
  if (text.length > 2000) return { ok: false, error: "Keep it under 2,000 characters." };
  if (!(await ownJob(jobId, who.organizationId))) return { ok: false, error: "That conversation isn't there any more." };
  try {
    await postJobMessage(jobId, "external", text);
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Couldn't send that. Try again." };
  }
  refresh();
  return { ok: true, message: "Sent." };
}

/** It's dealt with: rung back, or nothing to say. Off the list for everyone. */
export async function markClientMessageDealtWith(jobId: string): Promise<AmResult> {
  const who = await accountDesk();
  if (!who) return { ok: false, error: "Only an account manager or the owner can do that here." };
  if (!(await ownJob(jobId, who.organizationId))) return { ok: false, error: "That conversation isn't there any more." };
  const r = await markConversationRead(jobId, "external");
  if (!r.ok) return { ok: false, error: r.message };
  refresh();
  return { ok: true, message: "Marked dealt with." };
}
