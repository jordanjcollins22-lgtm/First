import nodemailer from "nodemailer";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { allowedToday, emailFooter, inSendWindow, sendBlocker } from "@/lib/pm-outreach";
import { startOfToday } from "@/lib/data/post-board";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The mailbox cold email goes out from: a separate domain, never the
 * business's main one, so a spam complaint about a cold email can never
 * touch the emails clients are waiting on. Set in Vercel as COLD_SMTP_HOST,
 * COLD_SMTP_USER, COLD_SMTP_PASS and, if not 465, COLD_SMTP_PORT.
 */
export const coldMailbox = {
  host: process.env.COLD_SMTP_HOST ?? "",
  port: Number(process.env.COLD_SMTP_PORT ?? 465),
  user: process.env.COLD_SMTP_USER ?? "",
  pass: process.env.COLD_SMTP_PASS ?? "",
  from: process.env.COLD_FROM_EMAIL ?? process.env.COLD_SMTP_USER ?? "",
  // Replies come back to the app's own inbox, so a reply stops the sequence
  // and is in front of the owner without anybody checking another mailbox.
  replyTo: process.env.COLD_REPLY_TO ?? "office@send.jslandscapingmd.com",
};
export const isColdMailboxSet = Boolean(coldMailbox.host && coldMailbox.user && coldMailbox.pass && coldMailbox.from);

export interface SendContext {
  organizationId: string;
  businessName: string;
  address: string | null;
  fromName: string;
  sendingOn: boolean;
  dailyCap: number;
  baseUrl: string;
}

/**
 * Send what is due, inside the sending hours and under today's allowance.
 * One email per company per run, each only after the one before it went,
 * the later ones as replies in the same thread.
 */
export async function sendDue(admin: Admin, ctx: SendContext, now: Date): Promise<{ sent: number; blocked: string | null }> {
  const blocked = sendBlocker({ sendingOn: ctx.sendingOn, mailbox: isColdMailboxSet, address: ctx.address });
  if (blocked) return { sent: 0, blocked };
  if (!inSendWindow(now)) return { sent: 0, blocked: "Outside the sending hours (weekdays 8am to 4pm)." };

  const [{ count: sentToday }, { data: first }] = await Promise.all([
    admin.from("pm_emails").select("id", { count: "exact", head: true }).eq("organization_id", ctx.organizationId).eq("status", "sent").gte("sent_at", startOfToday(now).toISOString()),
    admin.from("pm_emails").select("sent_at").eq("organization_id", ctx.organizationId).eq("status", "sent").order("sent_at").limit(1).maybeSingle(),
  ]);
  let room = allowedToday({ cap: ctx.dailyCap, firstSentAt: first?.sent_at ?? null, sentToday: sentToday ?? 0, now });
  if (room <= 0) return { sent: 0, blocked: "Today's allowance is used up." };

  const { data: due } = await admin
    .from("pm_emails")
    .select("id, company_id, step, subject, body, company:pm_companies!inner(id, name, email, contact_name, status, unsubscribe_token)")
    .eq("organization_id", ctx.organizationId)
    .eq("status", "scheduled")
    .lte("send_after", now.toISOString())
    .order("send_after")
    .limit(50);

  const transport = nodemailer.createTransport({
    host: coldMailbox.host,
    port: coldMailbox.port,
    secure: coldMailbox.port === 465,
    auth: { user: coldMailbox.user, pass: coldMailbox.pass },
  });

  type Due = { id: string; company_id: string; step: number; subject: string; body: string; company: { id: string; name: string; email: string | null; contact_name: string | null; status: string; unsubscribe_token: string } };
  const doneCompanies = new Set<string>();
  let sent = 0;
  for (const email of (due ?? []) as unknown as Due[]) {
    if (room <= 0) break;
    if (doneCompanies.has(email.company_id)) continue;
    doneCompanies.add(email.company_id);
    if (email.company.status !== "approved" || !email.company.email) continue;

    // The one before has to have gone first; its id threads this one under it.
    let inReplyTo: string | null = null;
    if (email.step > 1) {
      const { data: before } = await admin.from("pm_emails").select("status, message_id").eq("company_id", email.company_id).eq("step", email.step - 1).maybeSingle();
      if (before?.status !== "sent") continue;
      const { data: firstEmail } = await admin.from("pm_emails").select("message_id").eq("company_id", email.company_id).eq("step", 1).maybeSingle();
      inReplyTo = firstEmail?.message_id ?? before.message_id ?? null;
    }

    const base = ctx.baseUrl.replace(/\/$/, "");
    const unsubscribeUrl = `${base}/stop/${email.company.unsubscribe_token}`;
    const oneClickUrl = `${base}/api/pm/unsubscribe/${email.company.unsubscribe_token}`;
    const text = `${email.body.trim()}\n\n${emailFooter({ businessName: ctx.businessName, address: ctx.address ?? "", unsubscribeUrl })}`;
    try {
      const info = await transport.sendMail({
        from: { name: ctx.fromName, address: coldMailbox.from },
        to: email.company.contact_name ? { name: email.company.contact_name, address: email.company.email } : email.company.email,
        replyTo: coldMailbox.replyTo,
        subject: email.subject,
        text,
        inReplyTo: inReplyTo ?? undefined,
        references: inReplyTo ?? undefined,
        headers: {
          "List-Unsubscribe": `<${oneClickUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await admin.from("pm_emails").update({ status: "sent", sent_at: new Date().toISOString(), message_id: info.messageId, error: null }).eq("id", email.id);
      sent += 1;
      room -= 1;
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode ?? 0;
      const message = err instanceof Error ? err.message : String(err);
      await admin.from("pm_emails").update({ status: code >= 500 ? "failed" : "scheduled", error: message.slice(0, 300) }).eq("id", email.id);
      // A permanent refusal for the address: stop writing to it.
      if (code >= 550 && code < 560) {
        await stopCompany(admin, email.company_id, "bounced");
      }
      log.warn("pm.send_failed", { code, error: message.slice(0, 200) });
      if (code === 0 || code === 421 || code === 454) break;
    }
  }
  return { sent, blocked: null };
}

/** Stop a company's sequence for good: replied, unsubscribed, bounced or not interested. */
export async function stopCompany(admin: Admin, companyId: string, status: "replied" | "unsubscribed" | "bounced" | "not_interested" | "interested" | "do_not_contact"): Promise<void> {
  await admin.from("pm_companies").update({ status, updated_at: new Date().toISOString() }).eq("id", companyId);
  await admin.from("pm_emails").update({ status: "skipped" }).eq("company_id", companyId).in("status", ["draft", "scheduled"]);
}
