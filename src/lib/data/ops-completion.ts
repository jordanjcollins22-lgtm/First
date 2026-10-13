import type { SupabaseClient } from "@supabase/supabase-js";

import { isStripeConfigured } from "@/lib/env";
import { agreedTotal } from "@/lib/agreed-total";
import { createAndSendInvoice } from "@/lib/invoicing";
import { reportStripeFailure } from "@/lib/data/payments-health";
import { notifyTeamMember } from "@/lib/notifications";
import { alreadySent, contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { aftersMissing, beforeAfterEmail, canSendForApproval, clientReviewPath, type CloseoutInput } from "@/lib/project-closeout";
import { toReviewState } from "@/lib/data/client-review";
import { walkthroughGate } from "@/lib/walkthrough";
import { log } from "@/lib/log";
import { outboundBaseUrl } from "@/lib/base-url";
import { chainTriggered, planChain, type ChainFacts, type ReviewReadyReason } from "@/lib/ops/completion-chain";
import type { AutopilotSettings } from "@/lib/ops/autopilot-settings";
import { admin, ensureSettings, jobOrganizations, leadsFor } from "@/lib/data/ops-settings";
import { writeCostSnapshot } from "@/lib/data/ops-costing";
import type { WorkZone } from "@/components/canvas/types";

/**
 * The completion chain, run for one business at a time.
 *
 * Finds jobs whose last work day closed (or that were completed) after the
 * chain went live, and moves each one step on: the client's before & after
 * sign-off, then the invoice, then the cost snapshot, then the review hook.
 * Every step re-reads its facts, so running twice does nothing twice.
 */

/** Read the close-out gate with the service role (closeoutInputFor needs a signed-in user). */
async function closeoutInput(client: SupabaseClient, jobId: string, jobStatus: string): Promise<CloseoutInput> {
  const [{ data: design }, { data: photos }, { data: waivers }, { data: walks }, { data: marks }, { data: review }] = await Promise.all([
    client.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    client.from("job_photos").select("kind, zone_id").eq("job_id", jobId),
    client.from("job_photo_waivers").select("zone_id, stage").eq("job_id", jobId),
    client.from("job_walkthroughs").select("status, requested_at, reviewed_at, review_notes").eq("job_id", jobId).order("requested_at", { ascending: false }),
    client.from("job_photo_marks").select("resolved_at").eq("job_id", jobId),
    client
      .from("job_client_reviews")
      .select("status, sent_at, responded_at, client_note, recorded_by")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const zones = (((design as { zones?: unknown } | null)?.zones ?? []) as WorkZone[]).filter((z) => z.service).map((z) => ({ id: z.id, name: z.name }));
  const photoRows = (photos ?? []) as { kind: string; zone_id: string | null }[];
  const waivedAfter = new Set(((waivers ?? []) as { zone_id: string | null; stage: string }[]).filter((w) => w.stage === "after" && w.zone_id).map((w) => w.zone_id!));
  const missing = aftersMissing(photoRows.map((p) => ({ kind: p.kind, zoneId: p.zone_id })), zones, waivedAfter);
  return {
    started: jobStatus === "in_progress" || jobStatus === "completed" || photoRows.some((p) => p.kind === "during" || p.kind === "after"),
    walkthrough: walkthroughGate((walks ?? []) as Parameters<typeof walkthroughGate>[0]),
    aftersComplete: zones.length > 0 && missing.length === 0,
    aftersMissing: missing,
    review: toReviewState(review as Parameters<typeof toReviewState>[0]),
    openMarks: ((marks ?? []) as { resolved_at: string | null }[]).filter((m) => !m.resolved_at).length,
    photosApprovedAt: null,
    jobStatus,
  };
}

type ChainRow = {
  job_id: string;
  organization_id: string;
  trigger: string;
  cost_snapshot_at: string | null;
  review_ready_at: string | null;
  lead_nudged_at: string | null;
};

interface JobRow {
  id: string;
  name: string;
  status: string;
  completed_at: string | null;
  property: { address: string | null } | null;
}

/** Jobs that might need the chain, for one business. */
async function candidates(client: SupabaseClient, organizationId: string, liveSince: string): Promise<string[]> {
  const [{ data: closed }, { data: chains }, { data: completed }] = await Promise.all([
    client.from("job_work_sessions").select("job_id").eq("organization_id", organizationId).eq("status", "done").gte("closed_at", liveSince).limit(500),
    client
      .from("job_completion_chain")
      .select("job_id, review_ready_at, cost_snapshot_at")
      .eq("organization_id", organizationId)
      .or("review_ready_at.is.null,cost_snapshot_at.is.null")
      .limit(500),
    client.from("jobs").select("id").eq("status", "completed").gte("completed_at", liveSince).limit(500),
  ]);
  const ids = new Set<string>([
    ...((closed ?? []) as { job_id: string }[]).map((r) => r.job_id),
    ...((chains ?? []) as { job_id: string }[]).map((r) => r.job_id),
  ]);
  // Completed jobs come from every business; keep this one's.
  const done = ((completed ?? []) as { id: string }[]).map((j) => j.id);
  const orgs = await jobOrganizations(done, client);
  for (const id of done) if (orgs.get(id) === organizationId) ids.add(id);
  return [...ids];
}

export interface ChainRunResult {
  jobs: number;
  signoffs: number;
  invoices: number;
  snapshots: number;
  reviewReady: number;
}

export async function runCompletionChain(organizationId: string, now: Date = new Date()): Promise<ChainRunResult> {
  const out: ChainRunResult = { jobs: 0, signoffs: 0, invoices: 0, snapshots: 0, reviewReady: 0 };
  const client = admin();
  const { settings, ready } = await ensureSettings(organizationId, client);
  if (!ready || !settings.completionChainEnabled || !settings.completionChainStartedAt) return out;

  const ids = await candidates(client, organizationId, settings.completionChainStartedAt);
  for (const jobId of ids) {
    try {
      const r = await advanceJob(client, organizationId, jobId, settings, now);
      if (!r) continue;
      out.jobs++;
      out.signoffs += r.signoff ? 1 : 0;
      out.invoices += r.invoice ? 1 : 0;
      out.snapshots += r.snapshot ? 1 : 0;
      out.reviewReady += r.reviewReady ? 1 : 0;
    } catch (err) {
      log.error("ops.chain_failed", err, { organizationId, jobId });
    }
  }
  return out;
}

async function advanceJob(client: SupabaseClient, organizationId: string, jobId: string, settings: AutopilotSettings, now: Date) {
  const [{ data: job }, { data: sessions }, { data: chain }] = await Promise.all([
    client.from("jobs").select("id, name, status, completed_at, property:properties(address)").eq("id", jobId).maybeSingle(),
    client.from("job_work_sessions").select("status, closed_at").eq("job_id", jobId).neq("status", "cancelled"),
    client.from("job_completion_chain").select("job_id, organization_id, trigger, cost_snapshot_at, review_ready_at, lead_nudged_at").eq("job_id", jobId).maybeSingle(),
  ]);
  const j = job as unknown as JobRow | null;
  if (!j || j.status === "cancelled") return null;
  const sessionRows = (sessions ?? []) as { status: string; closed_at: string | null }[];
  const sessionsAllClosed = sessionRows.length > 0 && sessionRows.every((s) => s.status === "done");
  if (!chainTriggered({ jobStatus: j.status, sessionsAllClosed })) return null;

  let row = chain as ChainRow | null;
  if (!row) {
    // The go-live guard: only work that finished after the chain went live.
    const lastClosed = sessionRows.map((s) => s.closed_at).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
    const finishedAt = j.status === "completed" ? (j.completed_at ?? lastClosed) : lastClosed;
    if (!finishedAt || finishedAt < settings.completionChainStartedAt!) return null;
    const trigger = j.status === "completed" ? "job_completed" : "sessions_closed";
    const { error } = await client.from("job_completion_chain").insert({ job_id: jobId, organization_id: organizationId, trigger, stage: "Started" });
    if (error) return null;
    row = { job_id: jobId, organization_id: organizationId, trigger, cost_snapshot_at: null, review_ready_at: null, lead_nudged_at: null };
  }

  // ---------------------------------------------------------------- facts
  const [closeout, contact, invoiceRes, proposalRes, planRes, paidRes, snapRes] = await Promise.all([
    closeoutInput(client, jobId, j.status),
    client.from("jobs").select("property:properties(customer:customers(id, name, email, phone))").eq("id", jobId).maybeSingle(),
    client.from("invoices").select("id, status").eq("job_id", jobId).neq("status", "void").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("job_proposals").select("id, status, total_cost, discount_amount").eq("job_id", jobId).maybeSingle(),
    client.from("payment_plans").select("status").eq("job_id", jobId).in("status", ["accepted", "active", "settled"]).limit(1),
    client.from("payments").select("amount_cents").eq("job_id", jobId),
    client.from("job_cost_snapshots").select("final").eq("job_id", jobId).maybeSingle(),
  ]);
  const customer = (contact.data as unknown as { property: { customer: { id: string; name: string | null; email: string | null; phone: string | null } | null } | null } | null)?.property?.customer ?? null;
  const proposal = proposalRes.data as { id: string; status: string; total_cost: number | null; discount_amount: number | null } | null;
  const agreedCents = Math.round((agreedTotal(proposal) ?? 0) * 100);
  const paidCents = ((paidRes.data ?? []) as { amount_cents: number | null }[]).reduce((s, p) => s + Number(p.amount_cents ?? 0), 0);
  const invoiceStatus = (invoiceRes.data as { status: string } | null)?.status ?? null;
  const gate = canSendForApproval({ ...closeout, review: null });

  const facts: ChainFacts = {
    jobStatus: j.status,
    sessionsAllClosed,
    review: closeout.review ? { status: closeout.review.status, sentAt: closeout.review.sentAt } : null,
    closeoutBlockedBy: gate.ok ? null : gate.reason,
    clientHasEmail: Boolean(customer?.email?.trim() || customer?.phone?.trim()),
    invoice: invoiceStatus === "open" || invoiceStatus === "paid" || invoiceStatus === "uncollectible" ? invoiceStatus : "none",
    billedElsewhere: ((planRes.data ?? []) as unknown[]).length > 0 || (agreedCents > 0 && paidCents >= agreedCents),
    agreedCents,
    snapshotAt: row.cost_snapshot_at,
    snapshotFinal: Boolean((snapRes.data as { final: boolean } | null)?.final),
    reviewReadyAt: row.review_ready_at,
    leadNudgedAt: row.lead_nudged_at,
  };
  const plan = planChain(facts, settings, now);

  // ---------------------------------------------------------------- steps
  const patch: Record<string, unknown> = { stage: plan.stage, exception: plan.exception, updated_at: now.toISOString() };
  const done = { signoff: false, invoice: false, snapshot: false, reviewReady: false };

  for (const step of plan.steps) {
    if (step.kind === "send_signoff" && customer) {
      const sent = await sendSignoff(client, organizationId, jobId, customer, j.property?.address ?? null);
      if (sent.ok) {
        patch.signoff_review_id = sent.reviewId;
        patch.signoff_requested_at = now.toISOString();
        patch.stage = sent.held ? "Sign-off waiting for approval to send" : "Sign-off requested";
        done.signoff = true;
      } else {
        patch.exception = `The sign-off request didn't send: ${sent.message}`;
      }
    } else if (step.kind === "nudge_lead") {
      const lead = (await leadsFor([jobId], client)).get(jobId);
      if (lead) {
        await notifyTeamMember(lead, "team_messages", `${j.property?.address || j.name} is finished. Before the client's sign-off can go: ${step.reason}`, {
          dedupeKey: `ops-chain-nudge:${jobId}`,
        }).catch(() => false);
      }
      patch.lead_nudged_at = now.toISOString();
    } else if (step.kind === "raise_invoice") {
      const result = await raiseInvoice(organizationId, jobId, proposal, agreedCents);
      patch.invoice_state = result.state;
      patch.invoice_note = result.note;
      if (result.state === "raised") {
        patch.invoiced_at = now.toISOString();
        done.invoice = true;
      }
      if (result.state === "failed" || result.state === "not_connected") patch.exception = result.note;
    } else if (step.kind === "snapshot") {
      await writeCostSnapshot(organizationId, jobId, step.final, settings);
      patch.cost_snapshot_at = now.toISOString();
      done.snapshot = true;
    } else if (step.kind === "review_ready") {
      patch.review_ready_at = now.toISOString();
      patch.review_ready_reason = step.reason satisfies ReviewReadyReason;
      done.reviewReady = true;
    }
  }
  // Record why there was no invoice, for the panel, the first time it is decided.
  if (!plan.steps.some((s) => s.kind === "raise_invoice") && patch.invoice_state == null) {
    if (facts.invoice !== "none") patch.invoice_state = "existing";
    else if (facts.billedElsewhere) patch.invoice_state = "billed_elsewhere";
    else if (agreedCents === 0) patch.invoice_state = "not_billable";
  }

  await client.from("job_completion_chain").update(patch).eq("job_id", jobId);
  return done;
}

async function sendSignoff(
  client: SupabaseClient,
  organizationId: string,
  jobId: string,
  customer: { id: string; name: string | null; email: string | null; phone: string | null },
  address: string | null
): Promise<{ ok: true; reviewId: string; held: boolean } | { ok: false; message: string }> {
  const channel = customer.email?.trim() ? "email" : "sms";
  const dedupeKey = `before_after_review:auto:${jobId}`;
  // Tried before and refused (no consent, do-not-contact, a failed send):
  // the log says why, and retrying every fifteen minutes would not change it.
  if ((await alreadySent(organizationId, [dedupeKey])).has(dedupeKey)) {
    return { ok: false, message: "An earlier automatic attempt didn't go (see the client's message log). Send it from the job." };
  }
  const { data: review, error } = await client
    .from("job_client_reviews")
    .insert({ organization_id: organizationId, job_id: jobId, sent_to: channel === "email" ? customer.email : customer.phone, sent_by: null })
    .select("id, token")
    .single();
  if (error || !review) return { ok: false, message: "Couldn't start the approval." };

  const [{ data: org }, contacts] = await Promise.all([
    client.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", organizationId).maybeSingle(),
    contactsFor([customer.id]),
  ]);
  const contact = contacts.get(customer.id);
  if (!contact) {
    await client.from("job_client_reviews").delete().eq("id", review.id);
    return { ok: false, message: "Couldn't read the client's contact details." };
  }
  const link = `${await outboundBaseUrl()}${clientReviewPath((review as { token: string }).token)}`;
  const orgRow = (org ?? {}) as { name?: string; reminder_quiet_start?: number | null; reminder_quiet_end?: number | null; reminder_time_zone?: string | null };
  const email = beforeAfterEmail({ clientName: customer.name, businessName: orgRow.name ?? "", link, signedBy: null });
  const body =
    channel === "email"
      ? email.text
      : `Your project${address ? ` at ${address}` : ""} is finished. Here are the before & afters. Tap Approve if you're happy, or tell us what isn't right: ${link}`;

  const outcome = await sendClientMessage(
    {
      organizationId,
      customerId: customer.id,
      channel,
      basis: "service",
      kind: "before_after_review",
      referenceId: jobId,
      dedupeKey,
      subject: email.subject,
      body,
      automatic: true,
    },
    contact,
    quietWindowFor(orgRow)
  );
  if (outcome.sent) return { ok: true, reviewId: review.id as string, held: false };
  if (outcome.reason === "awaiting_approval") return { ok: true, reviewId: review.id as string, held: true };
  // Nothing reached them, so nothing is waiting on them. Quiet hours come
  // back round on the next run.
  await client.from("job_client_reviews").delete().eq("id", review.id);
  return { ok: false, message: outcome.reason === "quiet_hours" ? "Held for quiet hours; it will go in the morning." : outcome.detail };
}

/**
 * The existing Stripe invoice code, behind the same guards raiseInvoiceForJob
 * uses. Never a second invoice: invoices.job_id is unique and createAndSendInvoice
 * checks for a live one first.
 */
async function raiseInvoice(
  organizationId: string,
  jobId: string,
  proposal: { id: string; status: string } | null,
  agreedCents: number
): Promise<{ state: "raised" | "not_billable" | "not_connected" | "failed"; note: string }> {
  if (!proposal || !(agreedCents > 0)) return { state: "not_billable", note: "No accepted total to bill." };
  if (!isStripeConfigured) return { state: "not_connected", note: "Stripe isn't connected — add it in Settings › Integrations. The invoice will go once it is." };
  try {
    const sent = await createAndSendInvoice(jobId, proposal.id, agreedCents / 100);
    if (!sent) return { state: "failed", note: "The client has no contact on file to invoice." };
    return { state: "raised", note: "Invoice sent with the payment link." };
  } catch (err) {
    reportStripeFailure(organizationId, err).catch(() => {});
    return { state: "failed", note: "Stripe wouldn't take the invoice. Check the contact's details and raise it from the job." };
  }
}

/**
 * For workstream A2 (review requests): jobs that became ready for a review
 * request since `since`, oldest first. A2 decides whether and when to ask;
 * this only says the work is done and the client is happy (or paid).
 */
export async function jobsReadyForReviewRequest(organizationId: string, since: string, client: SupabaseClient = admin()) {
  const { data } = await client
    .from("job_completion_chain")
    .select("job_id, review_ready_at, review_ready_reason")
    .eq("organization_id", organizationId)
    .gte("review_ready_at", since)
    .order("review_ready_at", { ascending: true })
    .limit(500);
  return ((data ?? []) as { job_id: string; review_ready_at: string; review_ready_reason: ReviewReadyReason }[]).map((r) => ({
    jobId: r.job_id,
    readyAt: r.review_ready_at,
    reason: r.review_ready_reason,
  }));
}
