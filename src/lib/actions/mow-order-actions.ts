"use server";

import { revalidatePath } from "next/cache";
import { threadSentEmail } from "@/lib/data/thread-email";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { publicProof } from "@/lib/data/booking-proof";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { isOwnerLevel } from "@/lib/roles";
import { sendOutbound } from "@/lib/email/outbound";
import { refuseInDemo } from "@/lib/demo-mode";
import { log, maskEmail } from "@/lib/log";
import { dollars } from "@/lib/mow-price";
import { dayLabel } from "@/lib/mow-days";
import { welcomeEmail } from "@/lib/mow-messages";

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function teamMember() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  return tabsAllowedForRoles(profile.roles, permissions).has("mow-orders") ? profile : null;
}

/** Marks a request as called, paid or not, so the two-minute clock stops and it moves on. */
export async function markMowCalled(id: string): Promise<Result> {
  const profile = await teamMember();
  if (!profile) return { ok: false, message: "Only someone with the Quick Mow Pipeline can do that." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("mow_orders")
    .update({ called_at: now, called_by: profile.id, updated_at: now })
    .eq("id", id)
    .neq("status", "cancelled")
    .is("called_at", null);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/mow-orders");
  revalidatePath("/sales");
  return { ok: true };
}

export type WelcomeDraft = { ok: true; to: string; subject: string; body: string } | { ok: false; message: string };

async function welcomeFor(id: string, sender: string | null): Promise<(WelcomeDraft & { ok: true }) & { organizationId: string; customerId: string | null; name: string } | { ok: false; message: string }> {
  const admin = createAdminClient();
  const supabase = await createClient();
  // Read under the viewer's own sign-in first, so nobody reaches another business's order.
  const { data: order } = await supabase
    .from("mow_orders")
    .select("id, organization_id, customer_id, name, email, address, amount_cents, status, mow_day")
    .eq("id", id)
    .maybeSingle();
  if (!order) return { ok: false, message: "Couldn't find that request." };
  if (order.status !== "paid") return { ok: false, message: "This one hasn't paid yet. The email is for after they book." };
  const [{ data: org }, proof] = await Promise.all([
    admin.from("organizations").select("name, business_phone").eq("id", order.organization_id).maybeSingle(),
    publicProof(order.organization_id).catch(() => ({ reviews: [] as { author: string; body: string }[] })),
  ]);
  const { subject, body } = welcomeEmail({
    firstName: order.name.split(/\s+/)[0] ?? order.name,
    address: order.address,
    day: order.mow_day ? dayLabel(order.mow_day) : null,
    paid: dollars(order.amount_cents ?? 0),
    business: (org as { name?: string } | null)?.name ?? "JS Landscaping MD",
    phone: (org as { business_phone?: string | null } | null)?.business_phone ?? null,
    sender,
    reviews: proof.reviews.map((r) => ({ author: r.author, body: r.body })),
  });
  return { ok: true, to: order.email, subject, body, organizationId: order.organization_id, customerId: order.customer_id, name: order.name };
}

/** The "before your mow" email, word for word. Nothing is sent. */
export async function previewMowWelcome(id: string): Promise<WelcomeDraft> {
  const profile = await teamMember();
  if (!profile) return { ok: false, message: "Only someone with the Quick Mow Pipeline can do that." };
  const draft = await welcomeFor(id, profile.full_name?.trim().split(/\s+/)[0] ?? null);
  if (!draft.ok) return draft;
  return { ok: true, to: draft.to, subject: draft.subject, body: draft.body };
}

/** Sends it as shown, with any changes made. Once per request. */
export async function sendMowWelcome(input: { id: string; subject: string; body: string }): Promise<Result> {
  await refuseInDemo();
  const profile = await teamMember();
  if (!profile) return { ok: false, message: "Only someone with the Quick Mow Pipeline can do that." };
  const draft = await welcomeFor(input.id, null);
  if (!draft.ok) return draft;
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (!subject || !body) return { ok: false, message: "The email is empty." };

  const admin = createAdminClient();
  const dedupeKey = `mow_welcome:${input.id}`;
  const claim = await admin.from("client_message_log").insert({
    organization_id: draft.organizationId,
    customer_id: draft.customerId,
    channel: "email",
    kind: "mow_welcome",
    reference_id: input.id,
    dedupe_key: dedupeKey,
    status: "sent",
    body,
  });
  if (claim.error) return { ok: false, message: "That email has already gone to them." };

  const sent = await sendOutbound({
    organizationId: draft.organizationId,
    to: draft.to,
    toName: draft.name,
    subject,
    text: body,
    fromName: "JS Landscaping MD",
  });
  if (!sent.ok) {
    await admin.from("client_message_log").update({ status: "failed", detail: sent.message }).eq("dedupe_key", dedupeKey).eq("organization_id", draft.organizationId);
    return { ok: false, message: `It didn't send: ${sent.message}` };
  }
  await threadSentEmail(admin, { organizationId: draft.organizationId, customerId: draft.customerId, subject, body });
  await admin.from("mow_orders").update({ welcome_sent_at: new Date().toISOString() }).eq("id", input.id);
  log.info("mow.welcome_sent", { orderId: input.id, to: maskEmail(draft.to) });
  revalidatePath("/mow-orders");
  return { ok: true, message: `Sent to ${draft.to}.` };
}

/** Turns the two-minute team alerts on or off. An owner's call, since it texts people. */
export async function setQuickMowAlerts(on: boolean): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile || !(isOwnerLevel(profile.roles) || profile.roles.includes("admin"))) {
    return { ok: false, message: "Only an owner or admin can switch alerts on or off." };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ quick_mow_alerts: on }).eq("id", profile.organization_id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/mow-orders/funnel");
  return { ok: true, message: on ? "Alerts are on." : "Alerts are off." };
}
