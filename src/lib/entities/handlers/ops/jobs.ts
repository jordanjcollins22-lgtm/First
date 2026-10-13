import type { ActionResult, EntityAction, EntityHandler, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import {
  attempt,
  cents,
  dayLabel,
  isDay,
  JOB_STATUS_WORDS,
  jobStatusMoves,
  parseCosts,
  shiftSpan,
  spanLabel,
  splitResolution,
  stampLabel,
  toResult,
  WORK_DAY_WORDS,
  words,
  workDayIsOpen,
} from "@/lib/entities/ops-helpers";
import { jobLabel, many, own, ownJob, peopleNames, str, teamChoices, type Row } from "@/lib/entities/handlers/ops/common";
import { KIND_LABEL, type ExceptionKind } from "@/lib/exceptions";
import type { WorkZone } from "@/components/canvas/types";

import { cancelJob, reopenJob, updateJobStatus } from "@/lib/actions/job-actions";
import { completeJob } from "@/lib/actions/job-photo-actions";
import { addWorkSession, rescheduleWorkSession, setWorkSessionStatus } from "@/lib/actions/work-session-actions";
import { assignCrewMember, unassignCrewMember } from "@/lib/actions/job-crew-actions";
import { closeOneSession, recomputeJobCost } from "@/lib/actions/ops-autopilot-actions";
import { resolveIssue, setIssueBlocking } from "@/lib/actions/issue-actions";
import { acknowledgeException, dismissException, resolveException } from "@/lib/actions/exception-actions";
import { cancelWalkthroughRequest, reviewWalkthrough } from "@/lib/actions/walkthrough-actions";
import { approveAndSignOff, recordApprovalInPerson, sendBeforeAftersToClient } from "@/lib/actions/client-review-actions";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";

/**
 * Jobs and what hangs off them: the work days, the issues and exceptions
 * raised on site, the walkthrough and the client's sign-off.
 */

const NOT_YOURS: ActionResult = { ok: false, error: "That isn't one of yours." };

/* ------------------------------------------------------------------ job */

const job: EntityHandler = {
  kind: "ops.job",

  async load(ctx, id) {
    const j = await ownJob(
      ctx,
      id,
      "id, name, status, job_number, project_start_date, project_end_date, completed_at, cancellation_reason, final_crew_hours, final_materials_cents, final_other_cents, completion_notes"
    );
    if (!j) return null;
    const [sessions, crew, issues, exceptions, walks, reviews, cost, orders] = await Promise.all([
      many(ctx, "job_work_sessions", "id, starts_on, ends_on, status, purpose", (q) => q.eq("job_id", id).order("starts_on")),
      many(ctx, "job_crew", "profile_id, is_lead", (q) => q.eq("job_id", id)),
      many(ctx, "job_issues", "id, title, status, severity, blocking", (q) => q.eq("job_id", id).order("created_at", { ascending: false })),
      many(ctx, "job_exceptions", "id, summary, state, kind", (q) => q.eq("job_id", id).order("reported_at", { ascending: false }).limit(25)),
      many(ctx, "job_walkthroughs", "id, status, requested_at", (q) => q.eq("job_id", id).order("requested_at", { ascending: false })),
      many(ctx, "job_client_reviews", "id, status, sent_at", (q) => q.eq("job_id", id).order("sent_at", { ascending: false })),
      many(ctx, "job_cost_snapshots", "actual_hours, budget_hours, labor_cents, materials_cents, gross_margin_cents, gross_margin_pct, revenue_cents, computed_at", (q) => q.eq("job_id", id).limit(1)),
      many(ctx, "purchase_orders", "id, po_number, status", (q) => q.eq("job_id", id).order("created_at", { ascending: false })),
    ]);
    const names = await peopleNames(ctx, crew.map((c) => c.profile_id));
    const customer = ((j.property as Row | null)?.customer as Row | null) ?? null;
    const status = str(j.status);
    const c = cost[0];
    const lead = crew.find((m) => m.is_lead);

    const actions: EntityAction[] = [];
    const moves = jobStatusMoves(status);
    if (moves.length) {
      actions.push({
        id: "status",
        label: "Change status",
        input: { type: "select", label: "New status", options: moves.map((s) => ({ value: s, label: JOB_STATUS_WORDS[s] ?? words(s) })), required: true },
      });
    }
    if (status !== "completed" && status !== "cancelled") {
      actions.push({
        id: "complete",
        label: "Mark complete",
        tone: "primary",
        confirm: "Sign this job off as complete?",
        input: { type: "textarea", label: "Notes for the sign-off (optional)" },
      });
      actions.push({ id: "add_day", label: "Book a work day", input: { type: "date", label: "Day", required: true } });
      const choices = await teamChoices(ctx, crew.map((m) => str(m.profile_id)));
      if (choices.length) actions.push({ id: "add_crew", label: "Add to the crew", input: { type: "select", label: "Who", options: choices, required: true } });
    }
    if (crew.length && status !== "completed" && status !== "cancelled") {
      actions.push({
        id: "remove_crew",
        label: "Take off the crew",
        input: { type: "select", label: "Who", options: crew.map((m) => ({ value: str(m.profile_id), label: names.get(str(m.profile_id)) ?? "Crew member" })), required: true },
      });
    }
    actions.push({ id: "recost", label: "Recalculate cost" });
    if (status === "cancelled") actions.push({ id: "reopen", label: "Reopen job" });
    else if (status !== "completed") {
      actions.push({
        id: "cancel",
        label: "Cancel job",
        tone: "danger",
        confirm: "Cancel this job and take it off the calendar? Nothing is deleted; it can be reopened.",
        input: { type: "text", label: "Why (optional)" },
      });
    }

    return {
      title: jobLabel(j),
      subtitle: [j.job_number ? `Job #${j.job_number}` : null, str(customer?.name) || null].filter(Boolean).join(" · ") || undefined,
      status: JOB_STATUS_WORDS[status] ?? words(status),
      fields: [
        { label: "Client", value: str(customer?.name) },
        { label: "Address", value: str((j.property as Row | null)?.address) },
        { label: "Work dates", value: spanLabel(j.project_start_date, j.project_end_date) },
        { label: "Crew lead", value: lead ? (names.get(str(lead.profile_id)) ?? "") : "" },
        { label: "Hours", value: c ? `${Number(c.actual_hours ?? 0)}h${c.budget_hours != null ? ` of ${Number(c.budget_hours)}h budgeted` : ""}` : j.final_crew_hours != null ? `${Number(j.final_crew_hours)}h (final)` : "" },
        { label: "Labor", value: c ? cents(c.labor_cents) : "" },
        { label: "Materials", value: c ? cents(c.materials_cents) : j.final_materials_cents != null ? cents(j.final_materials_cents) : "" },
        { label: "Margin", value: c ? `${cents(c.gross_margin_cents)}${c.gross_margin_pct != null ? ` (${Math.round(Number(c.gross_margin_pct))}%)` : ""}` : "" },
        ...(j.completed_at ? [{ label: "Completed", value: stampLabel(j.completed_at) }] : []),
        ...(j.cancellation_reason ? [{ label: "Cancelled because", value: str(j.cancellation_reason) }] : []),
      ],
      sections: [
        {
          title: "Work days",
          rows: sessions.map((s) => row(`${spanLabel(s.starts_on, s.ends_on)} · ${WORK_DAY_WORDS[str(s.status)] ?? words(s.status)}${s.purpose ? ` · ${str(s.purpose).slice(0, 50)}` : ""}`, "ops.work_day", s.id)),
          empty: "No work days booked.",
        },
        {
          title: "Crew",
          rows: crew.map((m) => row(`${names.get(str(m.profile_id)) ?? "Crew member"}${m.is_lead ? " · lead" : ""}`, "ops.crew_member", m.profile_id)),
          empty: "Nobody on the crew yet.",
        },
        {
          title: "Issues",
          rows: issues.map((i) => row(`${str(i.title)} · ${words(i.status)}${i.blocking && i.status === "open" ? " · stops the job" : ""}`, "ops.issue", i.id)),
          empty: "No issues raised.",
        },
        {
          title: "Exceptions",
          rows: exceptions.map((e) => row(`${str(e.summary)} · ${words(e.state)}`, "ops.exception", e.id)),
          empty: "No exceptions reported.",
        },
        {
          title: "Close-out",
          rows: [
            ...walks.map((w) => row(`Walkthrough ${stampLabel(w.requested_at)} · ${words(w.status)}`, "ops.walkthrough", w.id)),
            ...reviews.map((r) => row(`Client review ${stampLabel(r.sent_at)} · ${words(r.status)}`, "ops.review", r.id)),
          ],
          empty: "No walkthrough or client review yet.",
        },
        { title: "Purchase orders", rows: orders.map((o) => row(`PO ${o.po_number} · ${words(o.status)}`, "ops.po", o.id)), empty: "No orders for this job." },
        ...(customer?.id ? [{ title: "Client", rows: [row(str(customer.name) || "Client", "ops.client", customer.id)] }] : []),
      ],
      actions,
      note: status === "completed" ? "Signed off. Recalculate the cost if a time entry was corrected." : "Mark complete checks the walkthrough, the client's approval and the photos first.",
    };
  },

  async act(ctx, id, action, value) {
    const j = await ownJob(ctx, id);
    if (!j) return NOT_YOURS;
    switch (action) {
      case "status": {
        if (!value || !jobStatusMoves(str(j.status)).includes(value)) return { ok: false, error: "Pick one of the statuses offered." };
        return attempt(() => updateJobStatus(id, value), `Moved to ${JOB_STATUS_WORDS[value] ?? value}.`);
      }
      case "complete": {
        const design = await getCanvasDesignForJob(id).catch(() => null);
        const zones = design ? ((design.zones as unknown as WorkZone[]) ?? []).filter((z) => z.service).map((z) => ({ id: z.id, name: z.name })) : [];
        return toResult(await completeJob(id, value?.trim() || null, zones));
      }
      case "add_day":
        if (!isDay(value)) return { ok: false, error: "Pick a day." };
        return toResult(await addWorkSession(id, value, value, null));
      case "add_crew":
        if (!value) return { ok: false, error: "Pick somebody." };
        return toResult(await assignCrewMember(id, value), "Added to the crew.");
      case "remove_crew":
        if (!value) return { ok: false, error: "Pick somebody." };
        return toResult(await unassignCrewMember(id, value), "Taken off the crew.");
      case "recost":
        return toResult(await recomputeJobCost(id));
      case "cancel":
        return toResult(await cancelJob(id, value?.trim() || null));
      case "reopen":
        return toResult(await reopenJob(id));
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------------- work day */

const workDay: EntityHandler = {
  kind: "ops.work_day",

  async load(ctx, id) {
    const s = await own(ctx, "job_work_sessions", "id, job_id, starts_on, ends_on, status, purpose, pause_reason, kits, subcontractor_id", id);
    if (!s) return null;
    const [j, crew, entries] = await Promise.all([
      ownJob(ctx, str(s.job_id)),
      many(ctx, "job_crew", "profile_id, is_lead", (q) => q.eq("job_id", s.job_id)),
      many(ctx, "time_entries", "profile_id, clocked_in_at, clocked_out_at", (q) => q.eq("session_id", id).order("clocked_in_at")),
    ]);
    if (!j) return null;
    const names = await peopleNames(ctx, [...crew.map((c) => c.profile_id), ...entries.map((e) => e.profile_id)]);
    const status = str(s.status);
    const open = workDayIsOpen(status);

    const actions: EntityAction[] = [];
    if (open) {
      actions.push({ id: "reschedule", label: "Reschedule", input: { type: "date", label: "New first day", initial: str(s.starts_on), required: true } });
      const choices = await teamChoices(ctx, crew.map((c) => str(c.profile_id)));
      if (choices.length) actions.push({ id: "assign", label: "Assign crew", input: { type: "select", label: "Who", options: choices, required: true } });
      if (status === "scheduled" || status === "paused") actions.push({ id: "start", label: status === "paused" ? "Resume" : "Start" });
      if (status === "in_progress") actions.push({ id: "pause", label: "Pause", input: { type: "text", label: "Why it stopped", placeholder: "Waiting on stone, rain…" } });
      actions.push({ id: "close_done", label: "Close as done", tone: "primary" });
      actions.push({ id: "close_not_worked", label: "Close as not worked", tone: "danger", confirm: "Close this day as not worked?" });
    }

    return {
      title: `${dayLabel(s.starts_on)} · ${jobLabel(j)}`,
      subtitle: str(s.purpose) || "Work day",
      status: WORK_DAY_WORDS[status] ?? words(status),
      fields: [
        { label: "Days", value: spanLabel(s.starts_on, s.ends_on) },
        { label: "Job", value: jobLabel(j) },
        { label: "What", value: str(s.purpose) },
        ...(s.pause_reason ? [{ label: "Paused because", value: str(s.pause_reason) }] : []),
        { label: "Kits", value: Array.isArray(s.kits) && s.kits.length ? (s.kits as number[]).join(", ") : "" },
        ...(s.subcontractor_id ? [{ label: "Done by", value: "A subcontractor" }] : []),
      ],
      sections: [
        { title: "Job", rows: [row(jobLabel(j), "ops.job", j.id)] },
        {
          title: "Crew",
          rows: crew.map((m) => row(`${names.get(str(m.profile_id)) ?? "Crew member"}${m.is_lead ? " · lead" : ""}`, "ops.crew_member", m.profile_id)),
          empty: "Nobody on this job's crew yet.",
        },
        {
          title: "Time on this day",
          rows: entries.map((e) => row(`${names.get(str(e.profile_id)) ?? "Someone"} · ${stampLabel(e.clocked_in_at)} to ${e.clocked_out_at ? stampLabel(e.clocked_out_at) : "still in"}`, "ops.crew_member", e.profile_id)),
          empty: "Nobody clocked in.",
        },
      ],
      actions,
      note: open ? "The crew is the job's crew: assigning here adds them to every day of the job. Rescheduling keeps the visit's length." : "This day is closed.",
    };
  },

  async act(ctx, id, action, value) {
    const s = await own(ctx, "job_work_sessions", "id, job_id, starts_on, ends_on", id);
    if (!s) return NOT_YOURS;
    switch (action) {
      case "reschedule": {
        if (!isDay(value)) return { ok: false, error: "Pick a day." };
        const span = shiftSpan(str(s.starts_on), str(s.ends_on), value);
        return toResult(await rescheduleWorkSession(id, span.start, span.end));
      }
      case "assign":
        if (!value) return { ok: false, error: "Pick somebody." };
        return toResult(await assignCrewMember(str(s.job_id), value), "Added to the crew.");
      case "start":
        return toResult(await setWorkSessionStatus(id, "in_progress"), "Started.");
      case "pause":
        return toResult(await setWorkSessionStatus(id, "paused", value ?? null), "Paused.");
      case "close_done":
        return toResult(await closeOneSession(id, "done"));
      case "close_not_worked":
        return toResult(await closeOneSession(id, "cancelled"));
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ---------------------------------------------------------------- issue */

const issue: EntityHandler = {
  kind: "ops.issue",

  async load(ctx, id) {
    const i = await own(ctx, "job_issues", "id, job_id, type, severity, title, description, status, owner_id, created_by, created_at, due_at, blocking, resolution, prevention, resolved_at", id);
    if (!i) return null;
    const [j, names] = await Promise.all([ownJob(ctx, str(i.job_id)), peopleNames(ctx, [i.owner_id, i.created_by])]);
    const open = i.status === "open";
    const actions: EntityAction[] = [];
    if (open) {
      if (!i.owner_id) actions.push({ id: "acknowledge", label: "Acknowledge (I'll own it)" });
      actions.push({
        id: "resolve",
        label: "Resolve",
        tone: "primary",
        input: {
          type: "textarea",
          label: "What was done, then on a new line what changes so it can't happen again",
          placeholder: "Replaced the cracked pavers\nCheck every pallet when it's delivered",
          required: true,
        },
      });
      actions.push({ id: "blocking", label: i.blocking ? "Let the job carry on" : "Stop the job until it's fixed" });
      actions.push({ id: "dismiss", label: "Dismiss", tone: "danger", confirm: "Dismiss this issue as not a problem?", input: { type: "text", label: "Why it isn't a problem", required: true } });
    }
    return {
      title: str(i.title),
      subtitle: j ? jobLabel(j) : undefined,
      status: words(i.status),
      fields: [
        { label: "Type", value: words(i.type) },
        { label: "Severity", value: words(i.severity) },
        { label: "Stops the job", value: i.blocking ? "Yes" : "No" },
        { label: "What happened", value: str(i.description) },
        { label: "Raised", value: `${stampLabel(i.created_at)}${i.created_by ? ` by ${names.get(str(i.created_by)) ?? "someone"}` : ""}` },
        { label: "Owner", value: i.owner_id ? (names.get(str(i.owner_id)) ?? "") : "Nobody yet" },
        ...(i.due_at ? [{ label: "Due", value: stampLabel(i.due_at) }] : []),
        ...(i.resolution ? [{ label: "Resolution", value: str(i.resolution) }] : []),
        ...(i.prevention ? [{ label: "So it can't happen again", value: str(i.prevention) }] : []),
      ],
      sections: j ? [{ title: "Job", rows: [row(jobLabel(j), "ops.job", j.id)] }] : [],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    const i = await own(ctx, "job_issues", "id, job_id, status, blocking", id);
    if (!i) return NOT_YOURS;
    if (i.status !== "open") return { ok: false, error: "This issue is already closed." };
    const jobId = str(i.job_id);
    switch (action) {
      case "acknowledge": {
        const { error } = await ctx.sb
          .from("job_issues")
          .update({ owner_id: ctx.profileId, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("organization_id", ctx.organizationId);
        return error ? { ok: false, error: "Couldn't save that." } : { ok: true, message: "It's yours." };
      }
      case "resolve": {
        const parts = splitResolution(value);
        if (!parts) return { ok: false, error: "Put what was done on one line, and what changes so it can't happen again on the next." };
        return toResult(await resolveIssue({ issueId: id, jobId, ...parts }), "Resolved.");
      }
      case "blocking":
        return toResult(await setIssueBlocking({ issueId: id, jobId, blocking: !i.blocking }), i.blocking ? "The job can carry on." : "The job is stopped until this is fixed.");
      case "dismiss": {
        const why = (value ?? "").trim();
        if (!why) return { ok: false, error: "Say why it isn't a problem." };
        const now = new Date().toISOString();
        const { error } = await ctx.sb
          .from("job_issues")
          .update({ status: "cancelled", resolution: why, resolved_by: ctx.profileId, resolved_at: now, updated_at: now })
          .eq("id", id)
          .eq("organization_id", ctx.organizationId);
        return error ? { ok: false, error: "Couldn't dismiss it." } : { ok: true, message: "Dismissed." };
      }
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------------ exception */

const exception: EntityHandler = {
  kind: "ops.exception",

  async load(ctx, id) {
    const e = await own(ctx, "job_exceptions", "id, job_id, work_session_id, kind, state, summary, detail, blocks_work, reported_by, reported_at, acknowledged_by, acknowledged_at, resolution, resolved_at", id);
    if (!e) return null;
    const [j, names] = await Promise.all([ownJob(ctx, str(e.job_id)), peopleNames(ctx, [e.reported_by, e.acknowledged_by])]);
    const state = str(e.state);
    const actions: EntityAction[] = [];
    if (state === "reported") actions.push({ id: "acknowledge", label: "Acknowledge", tone: "primary" });
    if (state === "reported" || state === "acknowledged") {
      actions.push({ id: "resolve", label: "Resolve", input: { type: "textarea", label: "What was done about it", required: true } });
      actions.push({ id: "dismiss", label: "Dismiss", tone: "danger", confirm: "Dismiss this as not a problem?", input: { type: "text", label: "Why it isn't a problem", required: true } });
    }
    const rows: EntityRow[] = [];
    if (j) rows.push(row(jobLabel(j), "ops.job", j.id));
    if (e.work_session_id) rows.push(row("The work day it was on", "ops.work_day", e.work_session_id));
    return {
      title: str(e.summary),
      subtitle: j ? jobLabel(j) : undefined,
      status: words(state),
      fields: [
        { label: "Kind", value: KIND_LABEL[str(e.kind) as ExceptionKind] ?? words(e.kind) },
        { label: "Detail", value: str(e.detail) },
        { label: "Crew can carry on", value: e.blocks_work ? "No" : "Yes" },
        { label: "Reported", value: `${stampLabel(e.reported_at)}${e.reported_by ? ` by ${names.get(str(e.reported_by)) ?? "someone"}` : " by the system"}` },
        ...(e.acknowledged_at ? [{ label: "Acknowledged", value: `${stampLabel(e.acknowledged_at)} by ${names.get(str(e.acknowledged_by)) ?? "someone"}` }] : []),
        ...(e.resolution ? [{ label: "Resolution", value: str(e.resolution) }] : []),
      ],
      sections: [{ title: "Where", rows }],
      actions,
    };
  },

  async act(ctx, id, action, value) {
    if (!(await own(ctx, "job_exceptions", "id", id))) return NOT_YOURS;
    switch (action) {
      case "acknowledge":
        return toResult(await acknowledgeException(id), "Acknowledged.");
      case "resolve":
        return toResult(await resolveException(id, value ?? ""), "Resolved.");
      case "dismiss":
        return toResult(await dismissException(id, value ?? ""), "Dismissed.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ---------------------------------------------------------- walkthrough */

const walkthrough: EntityHandler = {
  kind: "ops.walkthrough",

  async load(ctx, id) {
    const w = await own(ctx, "job_walkthroughs", "id, job_id, status, requested_by, requested_at, requested_note, reviewed_by, reviewed_at, review_notes", id);
    if (!w) return null;
    const [j, names] = await Promise.all([ownJob(ctx, str(w.job_id)), peopleNames(ctx, [w.requested_by, w.reviewed_by])]);
    const waiting = w.status === "requested";
    return {
      title: `Walkthrough · ${j ? jobLabel(j) : "Job"}`,
      subtitle: `Asked for ${stampLabel(w.requested_at)}`,
      status: words(w.status),
      fields: [
        { label: "Asked by", value: names.get(str(w.requested_by)) ?? "" },
        { label: "Their note", value: str(w.requested_note) },
        ...(w.reviewed_at ? [{ label: "Decided", value: `${stampLabel(w.reviewed_at)} by ${names.get(str(w.reviewed_by)) ?? "someone"}` }] : []),
        ...(w.review_notes ? [{ label: "Punch list", value: str(w.review_notes) }] : []),
      ],
      sections: j ? [{ title: "Job", rows: [row(jobLabel(j), "ops.job", j.id)] }] : [],
      actions: waiting
        ? [
            { id: "approve", label: "Approve", tone: "primary" },
            { id: "reject", label: "Send back with changes", input: { type: "textarea", label: "What needs fixing", required: true } },
            { id: "withdraw", label: "Withdraw the request", tone: "danger", confirm: "Withdraw this walkthrough request?" },
          ]
        : [],
      note: waiting ? "The crew is waiting on this to pack up." : "Decided.",
    };
  },

  async act(ctx, id, action, value) {
    const w = await own(ctx, "job_walkthroughs", "id, job_id, status", id);
    if (!w) return NOT_YOURS;
    if (w.status !== "requested") return { ok: false, error: "This walkthrough has already been decided." };
    const jobId = str(w.job_id);
    switch (action) {
      case "approve":
        return toResult(await reviewWalkthrough(jobId, true, null));
      case "reject":
        return toResult(await reviewWalkthrough(jobId, false, value ?? null));
      case "withdraw":
        return toResult(await cancelWalkthroughRequest(jobId), "Withdrawn.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* --------------------------------------------------------- client review */

const review: EntityHandler = {
  kind: "ops.review",

  async load(ctx, id) {
    const r = await own(ctx, "job_client_reviews", "id, job_id, status, sent_to, sent_at, responded_at, client_note", id);
    if (!r) return null;
    const j = await ownJob(ctx, str(r.job_id), "id, name, status, photos_approved_at");
    if (!j) return null;
    const status = str(r.status);
    const actions: EntityAction[] = [];
    if (status !== "approved") {
      actions.push({ id: "resend", label: "Send the before & afters again", confirm: "Send the client a fresh link to the before and after photos?" });
      actions.push({ id: "in_person", label: "They approved it in person" });
    }
    if (status === "approved" && !j.photos_approved_at) {
      actions.push({
        id: "sign_off",
        label: "Approve and sign off",
        tone: "primary",
        input: { type: "text", label: "What it really cost: crew hours, materials $, other $", placeholder: "32, 410, 0", required: true },
      });
    }
    return {
      title: `Client review · ${jobLabel(j)}`,
      subtitle: `Sent ${stampLabel(r.sent_at)}`,
      status: words(status),
      fields: [
        { label: "Sent to", value: str(r.sent_to) },
        { label: "Answered", value: r.responded_at ? stampLabel(r.responded_at) : "Not yet" },
        { label: "What they said", value: str(r.client_note) },
        { label: "Signed off", value: j.photos_approved_at ? stampLabel(j.photos_approved_at) : "Not yet" },
      ],
      sections: [{ title: "Job", rows: [row(jobLabel(j), "ops.job", j.id)] }],
      actions,
      note: "The link goes to the client through the usual client messages, with its approval rules.",
    };
  },

  async act(ctx, id, action, value) {
    const r = await own(ctx, "job_client_reviews", "id, job_id", id);
    if (!r) return NOT_YOURS;
    const jobId = str(r.job_id);
    switch (action) {
      case "resend":
        return toResult(await sendBeforeAftersToClient(jobId));
      case "in_person":
        return toResult(await recordApprovalInPerson(jobId));
      case "sign_off": {
        const costs = parseCosts(value);
        if (!costs) return { ok: false, error: "Put the crew's hours, the materials in dollars and anything else, e.g. 32, 410, 0." };
        return toResult(await approveAndSignOff(jobId, costs));
      }
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* --------------------------------------------------------------- client */

const client: EntityHandler = {
  kind: "ops.client",

  async load(ctx, id) {
    const c = await own(ctx, "customers", "id, name, email, phone, notes, do_not_contact", id);
    if (!c) return null;
    // Properties carry no organization of their own: they are the client's, checked above.
    const { data: propData } = await ctx.sb.from("properties").select("id, address").eq("customer_id", id);
    const props = (propData ?? []) as Row[];
    let jobs: Row[] = [];
    if (props.length) {
      try {
        const { data } = await ctx.sb
          .from("jobs")
          .select("id, name, status, project_start_date, property_id")
          .in("property_id", props.map((p) => str(p.id)))
          .order("created_at", { ascending: false })
          .limit(25);
        jobs = (data ?? []) as Row[];
      } catch {
        jobs = [];
      }
    }
    const addr = new Map(props.map((p) => [str(p.id), str(p.address)]));
    return {
      title: str(c.name) || "Client",
      status: c.do_not_contact ? "Do not contact" : undefined,
      fields: [
        { label: "Email", value: str(c.email) },
        { label: "Phone", value: str(c.phone) },
        { label: "Notes", value: str(c.notes) },
      ],
      sections: [
        {
          title: "Jobs",
          rows: jobs.map((j) => row(`${jobLabel({ name: j.name, property: { address: addr.get(str(j.property_id)) } })} · ${JOB_STATUS_WORDS[str(j.status)] ?? words(j.status)}${j.project_start_date ? ` · ${dayLabel(j.project_start_date)}` : ""}`, "ops.job", j.id)),
          empty: "No jobs.",
        },
      ],
      actions: [],
      note: "Open a job to act on it. The client's own details are kept in Sales.",
    };
  },
};

export const OPS_JOB_HANDLERS: EntityHandler[] = [job, workDay, issue, exception, walkthrough, review, client];
