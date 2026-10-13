import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { WorkZone } from "@/components/canvas/types";
import { forwardAreas, driveThereAndBack } from "@/lib/data/price-approvals";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { getMaterialSuppliers } from "@/lib/data/material-suppliers";
import { travelForProperty } from "@/lib/data/job-travel";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { recommendationFromRow, zonesForReview } from "@/lib/data/scope-reviews";
import { notifyTeamMember } from "@/lib/notifications";
import { priceFromSuppliers } from "@/lib/forward-materials";
import { priceForward, productionService, type PriceLine, type ProductionService } from "@/lib/forward-pricing";
import { zipOf } from "@/lib/material-suppliers";
import { isSalting } from "@/lib/salting";
import { reviewBlocker, reviewsFor } from "@/lib/scope-review";
import { zeroPriceBlocker } from "@/lib/proposal-guard";
import { DEFAULT_VALID_DAYS, expiryOf, isValidDays } from "@/lib/proposal-validity";
import { proposalReadyEmail } from "@/lib/proposal-ready-email";
import { proposalPath } from "@/lib/proposal-flow";
import { outboundBaseUrl } from "@/lib/base-url";
import { log } from "@/lib/log";
import { divisionOf } from "@/lib/sales/divisions";
import { checkGuardrails, type GuardrailLine, type GuardrailResult } from "@/lib/sales/price-guardrails";
import { decide, readAutopilot, sendKey, type AutopilotAction, type AutopilotRow, type AutopilotSettings } from "@/lib/sales/autopilot";
import { hoursWaiting, isOverdue } from "@/lib/sales/speed-to-proposal";
import { buildGoodBetterBest } from "@/lib/sales/good-better-best";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The pipeline autopilot, against the database.
 *
 * Runs as the service role: it is called from the cron with nobody signed
 * in, and from the evaluator's Submit after the response has gone (the
 * evaluator may not be allowed to approve prices themselves; the autopilot
 * is, inside the guardrails the owner set). Every query is scoped to the
 * organization it was given.
 */

type Admin = SupabaseClient<Database>;
// The new tables are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

const SETTINGS_COLUMNS =
  "auto_approve, auto_send, started_at, margin_maintenance, margin_install, margin_snow, margin_irrigation, formula_tolerance, speed_target_hours, overdue_exceptions, overdue_started_at, offer_options, mhic_license";

/** How often a held price is looked at again on its own, in case rates were filled in. */
const RECHECK_HELD_MS = 60 * 60_000;
/** Evaluations older than this are not chased for speed: the exception would only be noise. */
const OVERDUE_LOOKBACK_MS = 14 * 86_400_000;

export interface StoredAutopilot extends AutopilotSettings {
  /** False until migration 0361 is applied: nothing can be saved or acted on. */
  ready: boolean;
}

/** The settings as stored, or the defaults; never writes. */
export async function readAutopilotSettings(client: SupabaseClient, organizationId: string): Promise<StoredAutopilot> {
  const { data, error } = await untyped(client).from("sales_autopilot_settings").select(SETTINGS_COLUMNS).eq("organization_id", organizationId).maybeSingle();
  if (error) return { ...readAutopilot(null), ready: false };
  return { ...readAutopilot(data as Partial<AutopilotRow> | null), ready: true };
}

/**
 * The settings, created on first use. Both switches default on, so the
 * first read is the moment the autopilot goes live: started_at is written
 * then, and nothing submitted before it is ever touched.
 */
export async function ensureAutopilotSettings(admin: Admin, organizationId: string, now = new Date()): Promise<StoredAutopilot> {
  const current = await readAutopilotSettings(admin, organizationId);
  if (!current.ready) return current;
  const patch: Record<string, unknown> = {};
  if (current.autoApprove && !current.startedAt) patch.started_at = now.toISOString();
  if (current.overdueExceptions && !current.overdueStartedAt) patch.overdue_started_at = now.toISOString();
  if (Object.keys(patch).length === 0) return current;
  // Insert-or-fill: a row written by another run in the meantime keeps its own moments.
  await untyped(admin)
    .from("sales_autopilot_settings")
    .upsert({ organization_id: organizationId }, { onConflict: "organization_id", ignoreDuplicates: true });
  for (const [column, value] of Object.entries(patch)) {
    await untyped(admin).from("sales_autopilot_settings").update({ [column]: value }).eq("organization_id", organizationId).is(column, null);
  }
  return readAutopilotSettings(admin, organizationId);
}

// ---------------------------------------------------------------------------
// The guardrails, for one proposal
// ---------------------------------------------------------------------------

export interface ProposalEvaluation {
  jobId: string;
  organizationId: string;
  status: string;
  generatedAt: string;
  submittedAt: string | null;
  sentAt: string | null;
  evaluatorId: string | null;
  customerId: string | null;
  clientName: string;
  address: string;
  email: string | null;
  priceCents: number;
  formulaCents: number | null;
  guardrails: GuardrailResult;
  /** The lines the formula was priced from, per area, for Good/Better/Best. */
  lines: PriceLine[][] | null;
  services: ProductionService[];
  driveMinutesPerDay: number | null;
  hasOptions: boolean;
  token: string;
  validDays: number;
  expiresAt: string | null;
}

interface ProposalRow {
  status: string;
  total_cost: number | null;
  discount_amount: number | null;
  scope_snapshot: unknown;
  generated_at: string;
  sent_at: string | null;
  token: string;
  valid_days: number | null;
  expires_at: string | null;
  options: unknown;
}

interface JobRow {
  id: string;
  assigned_to: string | null;
  evaluation_status: string | null;
  evaluation_date: string | null;
  evaluation_submitted_at: string | null;
  property: { lat: number | null; lng: number | null; address: string; customer: { id: string; name: string; email: string | null; organization_id: string } | null } | null;
}

/**
 * Works out the price the rates give for this proposal's lines, the margin
 * at the quoted price, and whether it passes. Null when there is no
 * proposal on the job.
 */
export async function evaluateProposal(admin: Admin, organizationId: string, jobId: string, settings: AutopilotSettings): Promise<ProposalEvaluation | null> {
  const [{ data: proposal }, { data: job }, { data: design }, { data: services }, pricing, bulk, { data: recs }] = await Promise.all([
    admin
      .from("job_proposals")
      .select("status, total_cost, discount_amount, scope_snapshot, generated_at, sent_at, token, valid_days, expires_at, options")
      .eq("job_id", jobId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("jobs")
      .select("id, assigned_to, evaluation_status, evaluation_date, evaluation_submitted_at, property:properties(lat, lng, address, customer:customers(id, name, email, organization_id))")
      .eq("id", jobId)
      .maybeSingle(),
    admin.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    admin.from("services").select("service_type_id, name, status, cost, scope_template").eq("organization_id", organizationId),
    getProductionPricing(admin, organizationId),
    getMaterialSuppliers(admin, organizationId).catch(() => ({ suppliers: [] })),
    admin
      .from("scope_recommendations")
      .select("id, job_id, zone_index, zone_name, round, evaluator_note, service_label, recommended_text, status, decline_reason, decided_at, created_at")
      .eq("job_id", jobId),
  ]);
  const p = proposal as ProposalRow | null;
  const j = job as unknown as JobRow | null;
  if (!p || !j) return null;
  if (j.property?.customer && j.property.customer.organization_id !== organizationId) return null;

  const rateCard = (services ?? []) as { service_type_id: string; name: string; status: string; cost: number | null; scope_template: string | null }[];
  const rateById = new Map(rateCard.map((s) => [s.service_type_id, s]));
  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const snapshot = (Array.isArray(p.scope_snapshot) ? p.scope_snapshot : []) as ProposalZoneSnapshot[];
  const priceCents = Math.round((Number(p.total_cost ?? 0) - Number(p.discount_amount ?? 0)) * 100);
  const setup = { equation: pricing.equation, services: pricing.services };

  const otherHolds: string[] = [];
  if (j.evaluation_date && j.evaluation_status && !["completed", "cancelled"].includes(j.evaluation_status)) {
    otherHolds.push("The evaluation is still going on.");
  }
  const zeroBlocker = zeroPriceBlocker(p);
  if (zeroBlocker) otherHolds.push(zeroBlocker);
  const wording = reviewBlocker(reviewsFor(zonesForReview(zones, rateCard), (recs ?? []).map(recommendationFromRow)));
  if (wording) otherHolds.push(wording);

  let formulaCents: number | null = null;
  let costCents: number | null = null;
  let lines: PriceLine[][] | null = null;
  let drive: number | null = null;
  const guardLines: GuardrailLine[] = [];
  if (zones.some((z) => isSalting(z.service!.typeId))) {
    otherHolds.push("Salting is priced by the salt rules, not the production rates, so a person approves it.");
  } else if (zones.length === 0 || zones.length !== snapshot.length) {
    otherHolds.push("The site map's areas no longer match the proposal. Rebuild it from the site map.");
  } else {
    const name = (typeId: string) => rateById.get(typeId)?.name ?? typeId;
    lines = forwardAreas(zones, snapshot, name, setup).map((a) => a.lines);
    const site = j.property?.lat != null && j.property?.lng != null ? { lat: j.property.lat, lng: j.property.lng, zip: zipOf(j.property.address) } : null;
    lines = priceFromSuppliers(lines, setup.services, bulk.suppliers, site).lines;
    const travel = await travelForProperty(admin, organizationId, site ? { lat: site.lat, lng: site.lng } : null).catch(() => null);
    drive = travel ? driveThereAndBack(travel) : null;
    const priced = priceForward(lines, setup.equation, setup.services, drive);
    formulaCents = priced.rCents > 0 ? priced.rCents : null;
    costCents = priced.rCents > 0 ? Math.round(priced.costCents) : null;
    priced.areas.forEach((area, i) => {
      for (const line of area.lines) {
        const service = productionService(line.key, setup.services);
        const perJobCost = service?.unit === "job" && ((service.materialCentsPerUnit ?? 0) > 0 || line.materialCents > 0);
        guardLines.push({
          area: zones[i].name,
          label: line.label,
          division: divisionOf(line.key, line.label),
          hasRate: Boolean(service) && ((service!.pr ?? 0) > 0 || perJobCost),
          quantity: line.quantity,
          priceCents: line.rCents,
        });
      }
    });
  }
  const areasWithoutCardRate = zones
    .filter((z) => {
      const row = rateById.get(z.service!.typeId);
      return !row || row.cost == null || Number(row.cost) <= 0;
    })
    .map((z) => rateById.get(z.service!.typeId)?.name ?? z.service!.typeId);

  const eq = setup.equation;
  const guardrails = checkGuardrails({
    priceCents,
    formulaCents,
    costCents,
    sharesOfPrice: eq.affiliate + eq.evaluator + eq.accountManager + eq.reserve,
    lines: guardLines,
    areasWithoutCardRate,
    targets: settings.targets,
    tolerance: settings.tolerance,
    otherHolds,
  });

  const customer = j.property?.customer ?? null;
  return {
    jobId,
    organizationId,
    status: p.status,
    generatedAt: p.generated_at,
    submittedAt: j.evaluation_submitted_at,
    sentAt: p.sent_at,
    evaluatorId: j.assigned_to,
    customerId: customer?.id ?? null,
    clientName: customer?.name ?? "Client",
    address: j.property?.address ?? "",
    email: customer?.email?.trim() || null,
    priceCents,
    formulaCents,
    guardrails,
    lines,
    services: setup.services,
    driveMinutesPerDay: drive,
    hasOptions: Boolean(p.options),
    token: p.token,
    validDays: isValidDays(p.valid_days) ? p.valid_days : DEFAULT_VALID_DAYS,
    expiresAt: p.expires_at,
  };
}

// ---------------------------------------------------------------------------
// The autopilot, for one proposal
// ---------------------------------------------------------------------------

export interface AutopilotOutcome {
  jobId: string;
  action: AutopilotAction["kind"];
  why: string;
  reasons: string[];
  sent: boolean;
}

/**
 * Checks one proposal and does what the settings say: approve and send it,
 * approve it, or hold it with its reasons. Safe to call any number of times
 * for the same draft: the approval only moves a proposal still waiting on
 * this very draft, and the send is keyed so it can only happen once.
 */
export async function runAutopilotForJob(admin: Admin, organizationId: string, jobId: string, now = new Date()): Promise<AutopilotOutcome | null> {
  const settings = await ensureAutopilotSettings(admin, organizationId, now);
  if (!settings.ready) return null;
  const evaluation = await evaluateProposal(admin, organizationId, jobId, settings);
  if (!evaluation) return null;

  const action = decide(settings, {
    status: evaluation.status,
    submittedAt: evaluation.submittedAt,
    sentAt: evaluation.sentAt,
    passes: evaluation.guardrails.pass,
    hasEmail: Boolean(evaluation.email),
  });
  if (action.kind === "ignore") return { jobId, action: action.kind, why: action.why, reasons: evaluation.guardrails.reasons, sent: false };

  await recordCheck(admin, evaluation, action);

  if (action.kind === "hold") {
    await openException(admin, {
      organizationId,
      jobId,
      kind: "price_held",
      assignedTo: null,
      dedupeKey: `price_held:${jobId}:${evaluation.generatedAt}`,
      summary: `Price held for ${evaluation.clientName}: ${evaluation.guardrails.reasons[0] ?? "outside the guardrails"}`,
      detail: evaluation.guardrails.reasons.join("\n"),
    });
    return { jobId, action: action.kind, why: action.why, reasons: evaluation.guardrails.reasons, sent: false };
  }

  // Good / Better / Best, when asked for and the proposal has no options of its own.
  if (settings.offerOptions && !evaluation.hasOptions && evaluation.lines) {
    const pricing = await getProductionPricing(admin, organizationId);
    const options = buildGoodBetterBest({ areas: evaluation.lines, equation: pricing.equation, services: evaluation.services, driveMinutesPerDay: evaluation.driveMinutesPerDay });
    if (options) {
      await admin
        .from("job_proposals")
        .update({ options: options as unknown as Database["public"]["Tables"]["job_proposals"]["Update"]["options"] })
        .eq("job_id", jobId)
        .eq("status", "needs_approval")
        .is("options", null);
    }
  }

  const approved = await approveDraft(admin, evaluation, now);
  if (!approved) {
    return { jobId, action: "ignore", why: "Somebody else moved it first.", reasons: [], sent: false };
  }
  await resolveExceptions(admin, organizationId, jobId, ["price_held"], "Approved inside the guardrails.");

  let sent = false;
  if (action.kind === "approve_and_send") sent = await sendDraft(admin, evaluation, now);
  return { jobId, action: action.kind, why: action.why, reasons: [], sent };
}

/** The approval, as the office's Accept does it, but only for the draft that was checked. */
async function approveDraft(admin: Admin, evaluation: ProposalEvaluation, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from("job_proposals")
    .update({
      status: "sent",
      approved_at: now.toISOString(),
      valid_days: evaluation.validDays,
      expires_at: expiryOf(now, evaluation.validDays).toISOString(),
    })
    .eq("job_id", evaluation.jobId)
    .eq("organization_id", evaluation.organizationId)
    .eq("status", "needs_approval")
    .eq("generated_at", evaluation.generatedAt)
    .select("job_id");
  if (error) {
    log.error("autopilot.approve_failed", error, { jobId: evaluation.jobId });
    return false;
  }
  if (!data || data.length === 0) return false;
  await admin.from("jobs").update({ status: "quoted" }).eq("id", evaluation.jobId).eq("status", "estimating");
  return true;
}

/**
 * The client's email, through the one door every automated client message
 * uses: consent, do-not-contact, quiet hours and the business's approval
 * policy all apply. Quiet hours or a parked approval leave it unsent; the
 * cron comes back to it, and the key stops it ever going twice.
 */
async function sendDraft(admin: Admin, evaluation: ProposalEvaluation, now: Date): Promise<boolean> {
  if (!evaluation.customerId || !evaluation.email) return false;
  const [contacts, { data: org }] = await Promise.all([
    contactsFor([evaluation.customerId]),
    admin.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", evaluation.organizationId).maybeSingle(),
  ]);
  const contact = contacts.get(evaluation.customerId);
  if (!contact) return false;
  const key = sendKey(evaluation.jobId, evaluation.generatedAt);
  const email = proposalReadyEmail({
    clientName: evaluation.clientName,
    address: evaluation.address,
    validDays: evaluation.validDays,
    link: `${await outboundBaseUrl()}${proposalPath(evaluation.token)}`,
    businessName: org?.name ?? "",
    signedBy: null,
  });
  const outcome = await sendClientMessage(
    {
      organizationId: evaluation.organizationId,
      customerId: evaluation.customerId,
      channel: "email",
      basis: "service",
      kind: "proposal_ready",
      referenceId: evaluation.jobId,
      dedupeKey: key,
      subject: email.subject,
      body: email.text,
      automatic: true,
    },
    contact,
    quietWindowFor(org ?? {}),
    now
  );
  if (outcome.sent) {
    await markSent(admin, evaluation.organizationId, evaluation.jobId, evaluation.generatedAt, now.toISOString());
    return true;
  }
  if (outcome.reason === "already_sent") return (await reconcileOne(admin, evaluation.organizationId, evaluation.jobId, evaluation.generatedAt)) != null;
  log.info("autopilot.send_waiting", { jobId: evaluation.jobId, reason: outcome.reason });
  return false;
}

async function markSent(admin: Admin, organizationId: string, jobId: string, generatedAt: string, at: string) {
  await admin.from("job_proposals").update({ sent_at: at }).eq("job_id", jobId).eq("organization_id", organizationId).is("sent_at", null);
  await untyped(admin).from("proposal_guardrail_checks").update({ sent_at: at }).eq("job_id", jobId).eq("generated_at", generatedAt).is("sent_at", null);
  await resolveExceptions(admin, organizationId, jobId, ["proposal_overdue", "price_held"], "Sent to the client.");
}

/**
 * A send that went another way: approved on My Day after being parked, or
 * sent in a run that stopped before it wrote the date. Finds it in the
 * message log or the approval queue and writes the sent date. Returns it.
 */
async function reconcileOne(admin: Admin, organizationId: string, jobId: string, generatedAt: string): Promise<string | null> {
  const key = sendKey(jobId, generatedAt);
  const [{ data: logged }, { data: approval }] = await Promise.all([
    admin.from("client_message_log").select("created_at, status").eq("organization_id", organizationId).eq("dedupe_key", key).eq("status", "sent").maybeSingle(),
    admin.from("outbound_approvals").select("sent_at, status").eq("organization_id", organizationId).eq("dedupe_key", key).eq("status", "sent").maybeSingle(),
  ]);
  const at = approval?.sent_at ?? logged?.created_at ?? null;
  if (at) await markSent(admin, organizationId, jobId, generatedAt, at);
  return at;
}

async function recordCheck(admin: Admin, evaluation: ProposalEvaluation, action: AutopilotAction) {
  const g = evaluation.guardrails;
  const { error } = await untyped(admin)
    .from("proposal_guardrail_checks")
    .upsert(
      {
        organization_id: evaluation.organizationId,
        job_id: evaluation.jobId,
        generated_at: evaluation.generatedAt,
        passed: g.pass,
        reasons: g.reasons,
        division: g.division,
        margin_pct: g.marginPct,
        deviation_pct: g.deviationPct,
        price_cents: evaluation.priceCents,
        formula_cents: evaluation.formulaCents,
        action: action.kind,
        action_note: action.why,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "job_id,generated_at" }
    );
  if (error) log.error("autopilot.check_not_recorded", error, { jobId: evaluation.jobId });
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export type SalesExceptionKind = "proposal_overdue" | "price_held";

/** Opens one, once: a second call with the same key does nothing. Returns whether it is new. */
export async function openException(
  admin: Admin,
  input: { organizationId: string; jobId: string | null; kind: SalesExceptionKind; assignedTo: string | null; dedupeKey: string; summary: string; detail?: string | null }
): Promise<boolean> {
  const { data, error } = await untyped(admin)
    .from("sales_exceptions")
    .upsert(
      {
        organization_id: input.organizationId,
        job_id: input.jobId,
        kind: input.kind,
        assigned_to: input.assignedTo,
        dedupe_key: input.dedupeKey,
        summary: input.summary.slice(0, 500),
        detail: input.detail ?? null,
      },
      { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) {
    log.error("sales_exception.not_opened", error, { kind: input.kind, jobId: input.jobId });
    return false;
  }
  return (data ?? []).length > 0;
}

export async function resolveExceptions(admin: Admin, organizationId: string, jobId: string, kinds: SalesExceptionKind[], resolution: string) {
  await untyped(admin)
    .from("sales_exceptions")
    .update({ state: "resolved", resolved_at: new Date().toISOString(), resolution })
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .in("kind", kinds)
    .eq("state", "open");
}

// ---------------------------------------------------------------------------
// The run, for a whole business
// ---------------------------------------------------------------------------

export interface AutopilotRun {
  organizationId: string;
  checked: number;
  approved: number;
  sent: number;
  held: number;
  reconciled: number;
  overdueOpened: number;
  resolved: number;
  skipped?: string;
}

/**
 * Everything the cron does for one business, in order:
 *
 * 1. Proposals waiting on approval whose evaluation was submitted after the
 *    go-live: checked, and approved and sent when they pass. One already
 *    held is looked at again at most once an hour, in case rates went in.
 * 2. Approved by the autopilot but not yet in the client's hands (quiet
 *    hours, or parked for approval on My Day): sent, or its sent date
 *    picked up from wherever it went.
 * 3. Submitted evaluations past the speed target with nothing sent: an
 *    exception to the evaluator, once, with a text.
 * 4. Exceptions whose proposal has since gone (or the job is off): closed.
 */
export async function runAutopilotForOrg(admin: Admin, organizationId: string, now = new Date()): Promise<AutopilotRun> {
  const run: AutopilotRun = { organizationId, checked: 0, approved: 0, sent: 0, held: 0, reconciled: 0, overdueOpened: 0, resolved: 0 };
  const settings = await ensureAutopilotSettings(admin, organizationId, now);
  if (!settings.ready) return { ...run, skipped: "Migration 0361 is not applied." };

  // 1. Waiting on approval.
  if (settings.autoApprove && settings.startedAt) {
    const { data: waiting } = await admin
      .from("job_proposals")
      .select("job_id, generated_at, jobs!inner(evaluation_submitted_at)")
      .eq("organization_id", organizationId)
      .eq("status", "needs_approval")
      .gte("jobs.evaluation_submitted_at", settings.startedAt)
      .limit(50);
    const rows = (waiting ?? []) as unknown as { job_id: string; generated_at: string }[];
    const { data: checks } = await untyped(admin)
      .from("proposal_guardrail_checks")
      .select("job_id, generated_at, action, checked_at")
      .eq("organization_id", organizationId)
      .in("job_id", rows.length ? rows.map((r) => r.job_id) : ["00000000-0000-0000-0000-000000000000"]);
    const lastCheck = new Map(((checks ?? []) as { job_id: string; generated_at: string; action: string; checked_at: string }[]).map((c) => [`${c.job_id}|${new Date(c.generated_at).getTime()}`, c]));
    for (const row of rows) {
      const before = lastCheck.get(`${row.job_id}|${new Date(row.generated_at).getTime()}`);
      if (before?.action === "hold" && now.getTime() - new Date(before.checked_at).getTime() < RECHECK_HELD_MS) continue;
      const outcome = await runAutopilotForJob(admin, organizationId, row.job_id, now).catch((err: unknown) => {
        log.error("autopilot.job_failed", err, { jobId: row.job_id });
        return null;
      });
      if (!outcome) continue;
      run.checked++;
      if (outcome.action === "hold") run.held++;
      if (outcome.action === "approve" || outcome.action === "approve_and_send") run.approved++;
      if (outcome.sent) run.sent++;
    }
  }

  // 2. Approved here, not yet sent.
  const { data: unsent } = await untyped(admin)
    .from("proposal_guardrail_checks")
    .select("job_id, generated_at")
    .eq("organization_id", organizationId)
    .eq("action", "approve_and_send")
    .is("sent_at", null)
    .gte("checked_at", new Date(now.getTime() - OVERDUE_LOOKBACK_MS).toISOString())
    .limit(50);
  for (const row of (unsent ?? []) as { job_id: string; generated_at: string }[]) {
    const at = await reconcileOne(admin, organizationId, row.job_id, row.generated_at);
    if (at) {
      run.reconciled++;
      continue;
    }
    if (!settings.autoSend) continue;
    const evaluation = await evaluateProposal(admin, organizationId, row.job_id, settings).catch(() => null);
    // Only the same draft, still live and still unsent.
    if (!evaluation || evaluation.status !== "sent" || evaluation.sentAt || new Date(evaluation.generatedAt).getTime() !== new Date(row.generated_at).getTime()) continue;
    if (await sendDraft(admin, evaluation, now)) run.sent++;
  }

  // 3. Overdue: past the speed target with nothing in the client's hands.
  if (settings.overdueExceptions && settings.overdueStartedAt) {
    const floor = new Date(Math.max(new Date(settings.overdueStartedAt).getTime(), now.getTime() - OVERDUE_LOOKBACK_MS)).toISOString();
    const { data: jobs } = await admin
      .from("job_proposals")
      .select("job_id, status, sent_at, jobs!inner(assigned_to, evaluation_submitted_at, status, property:properties(address, customer:customers(name)))")
      .eq("organization_id", organizationId)
      .in("status", ["needs_approval", "sent"])
      .is("sent_at", null)
      .gte("jobs.evaluation_submitted_at", floor)
      .limit(200);
    for (const row of (jobs ?? []) as unknown as {
      job_id: string;
      sent_at: string | null;
      jobs: { assigned_to: string | null; evaluation_submitted_at: string; status: string; property: { address: string; customer: { name: string } | null } | null };
    }[]) {
      if (row.jobs.status === "cancelled") continue;
      if (!isOverdue(row.jobs.evaluation_submitted_at, row.sent_at, now, settings.speedTargetHours)) continue;
      const hours = Math.round(hoursWaiting(row.jobs.evaluation_submitted_at, now));
      const client = row.jobs.property?.customer?.name ?? "a client";
      const key = `proposal_overdue:${row.job_id}:${row.jobs.evaluation_submitted_at}`;
      const opened = await openException(admin, {
        organizationId,
        jobId: row.job_id,
        kind: "proposal_overdue",
        assignedTo: row.jobs.assigned_to,
        dedupeKey: key,
        summary: `${client}'s proposal hasn't gone out ${hours} hours after the evaluation (target ${settings.speedTargetHours} h).`,
        detail: row.jobs.property?.address ?? null,
      });
      if (opened) {
        run.overdueOpened++;
        if (row.jobs.assigned_to) {
          await notifyTeamMember(
            row.jobs.assigned_to,
            "proposal_responses",
            `${client}'s proposal hasn't gone out yet, ${hours} hours after the evaluation. Proposals sent within ${settings.speedTargetHours} hours close far more often. Finish it or flag what's stopping it.`,
            { dedupeKey: key }
          ).catch(() => false);
          await untyped(admin).from("sales_exceptions").update({ notified_at: now.toISOString() }).eq("organization_id", organizationId).eq("dedupe_key", key);
        }
      }
    }
  }

  // 4. Close what has been dealt with.
  const { data: open } = await untyped(admin).from("sales_exceptions").select("id, job_id, kind").eq("organization_id", organizationId).eq("state", "open").limit(500);
  const openRows = (open ?? []) as { id: string; job_id: string | null; kind: SalesExceptionKind }[];
  const ids = [...new Set(openRows.map((r) => r.job_id).filter((id): id is string => Boolean(id)))];
  if (ids.length > 0) {
    const { data: states } = await admin.from("job_proposals").select("job_id, status, sent_at").in("job_id", ids);
    const byJob = new Map((states ?? []).map((s) => [s.job_id, s]));
    const done = openRows.filter((r) => {
      const s = r.job_id ? byJob.get(r.job_id) : null;
      if (!s) return true;
      if (r.kind === "price_held") return s.status !== "needs_approval";
      return s.sent_at != null || s.status === "accepted" || s.status === "declined";
    });
    if (done.length > 0) {
      await untyped(admin)
        .from("sales_exceptions")
        .update({ state: "resolved", resolved_at: now.toISOString(), resolution: "Dealt with." })
        .in("id", done.map((r) => r.id));
      run.resolved += done.length;
    }
  }
  return run;
}

/** Every business, for the cron. */
export async function runAutopilotEverywhere(now = new Date()): Promise<AutopilotRun[]> {
  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");
  const runs: AutopilotRun[] = [];
  for (const org of orgs ?? []) {
    runs.push(
      await runAutopilotForOrg(admin, org.id, now).catch((err: unknown) => {
        log.error("autopilot.org_failed", err, { organizationId: org.id });
        return { organizationId: org.id, checked: 0, approved: 0, sent: 0, held: 0, reconciled: 0, overdueOpened: 0, resolved: 0, skipped: "Failed; see the log." };
      })
    );
  }
  return runs;
}
