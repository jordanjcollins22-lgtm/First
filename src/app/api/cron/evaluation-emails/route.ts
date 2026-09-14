import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { outboundReady, sendOutbound } from "@/lib/email/outbound";
import { log, maskEmail } from "@/lib/log";

/**
 * Sends the evaluation email sequence.
 *
 * The database says what is due: which step, for whom, with the words
 * already filled in and the window it is due within. This claims each one
 * so no other run can send it, sends it from the business's Gmail, and
 * records the message id so the next step in the sequence threads under
 * the first. Run it as often as you like; a step is sent once.
 */
type Due = {
  organization_id: string;
  job_id: string;
  customer_id: string;
  step: string;
  dedupe_key: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  body: string;
  reply_thread_id: string | null;
  fire_at: string;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "evaluation-emails");
  if (refused) return refused;
  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("evaluation_sequence_due");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const due = (rows ?? []) as Due[];

  const orgNames = new Map<string, { name: string; email: string | null }>();
  const ready = new Map<string, { ready: boolean; why: string }>();
  const counts = { sent: 0, failed: 0, claimedElsewhere: 0, notReady: 0 };

  for (const item of due) {
    if (!orgNames.has(item.organization_id)) {
      const { data: org } = await admin.from("organizations").select("name, business_email").eq("id", item.organization_id).maybeSingle();
      orgNames.set(item.organization_id, { name: org?.name ?? "JS Landscaping MD", email: org?.business_email ?? null });
      ready.set(item.organization_id, await outboundReady(item.organization_id));
    }
    const org = orgNames.get(item.organization_id)!;

    // Nothing is claimed until something can send it. A step claimed and
    // then failed would be marked failed and never retried; a step left
    // unclaimed is sent on the first run after the domain is ready.
    const can = ready.get(item.organization_id)!;
    if (!can.ready) {
      counts.notReady += 1;
      continue;
    }

    // Claimed first. A second run starting before this one finishes must
    // find the row taken.
    const { data: claimed, error: claimError } = await admin.rpc("evaluation_sequence_claim", {
      p_organization_id: item.organization_id,
      p_customer_id: item.customer_id,
      p_job_id: item.job_id,
      p_step: item.step,
      p_dedupe_key: item.dedupe_key,
      p_body: item.body,
    });
    if (claimError || !claimed) {
      counts.claimedElsewhere += 1;
      continue;
    }

    const sent = await sendOutbound({
      organizationId: item.organization_id,
      to: item.to_email,
      toName: item.to_name,
      subject: item.subject,
      text: item.body,
      fromName: org.name,
      inReplyTo: item.reply_thread_id,
    });

    if (sent.ok) {
      await admin.rpc("evaluation_sequence_sent", {
        p_dedupe_key: item.dedupe_key,
        p_message_id: sent.id,
        // The first email's id is the thread; later steps reply to it.
        p_thread_id: item.reply_thread_id ?? sent.id,
      });
      counts.sent += 1;
      log.info("evaluation.email.sent", { jobId: item.job_id, step: item.step, via: sent.via, to: maskEmail(item.to_email) });
    } else {
      await admin.rpc("evaluation_sequence_failed", { p_dedupe_key: item.dedupe_key, p_detail: sent.message });
      counts.failed += 1;
      log.warn("evaluation.email.failed", { jobId: item.job_id, step: item.step, error: sent.message });
    }
  }

  const notReady = [...ready.values()].find((r) => !r.ready);
  return NextResponse.json({ ok: true, due: due.length, ...counts, ...(notReady ? { why: notReady.why } : {}) });
}
