import type { ActionResult, EntityAction, EntityHandler } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { applicantMoves, attempt, dayLabel, dollars, JOB_STATUS_WORDS, parseNumber, spanLabel, stampLabel, toResult, words } from "@/lib/entities/ops-helpers";
import { jobNames, many, own, str, type Row } from "@/lib/entities/handlers/ops/common";
import { isStage, nextStages, STAGES } from "@/lib/hiring/screening";

import { updateProfilePay } from "@/lib/actions/team-actions";
import { assignCrewMember } from "@/lib/actions/job-crew-actions";
import { saveApplicantReview, setApplicantStage } from "@/lib/actions/hiring-actions";
import { deleteTeamPayment, markTeamPaymentPaid } from "@/lib/actions/payment-actions";

/**
 * The project team: the people on it, what they are owed, and the people
 * applying to join it. Roles are shown, never changed, here.
 */

const NOT_YOURS: ActionResult = { ok: false, error: "That isn't one of yours." };
const stageLabel = (s: unknown) => (isStage(str(s)) ? STAGES[str(s) as keyof typeof STAGES] : words(s));
const METHODS = [
  { value: "transfer", label: "Bank transfer" },
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

/* ---------------------------------------------------------- crew member */

const crewMember: EntityHandler = {
  kind: "ops.crew_member",

  async load(ctx, id) {
    const p = await own(ctx, "profiles", "id, full_name, email, phone, pay_type, pay_rate_per_hour, commission_pct, drives_for_company, trial_crew", id);
    if (!p) return null;
    const [rolesRes, crew, payments, entries] = await Promise.all([
      ctx.sb.from("profile_roles").select("role_name").eq("profile_id", id),
      many(ctx, "job_crew", "job_id, is_lead", (q) => q.eq("profile_id", id).order("created_at", { ascending: false }).limit(50)),
      many(ctx, "team_payments", "id, amount, status, period_start, period_end", (q) => q.eq("profile_id", id).order("created_at", { ascending: false }).limit(15)),
      many(ctx, "time_entries", "clocked_in_at, clocked_out_at, job_id", (q) => q.eq("profile_id", id).order("clocked_in_at", { ascending: false }).limit(10)),
    ]);
    const roles = ((rolesRes.data ?? []) as Row[]).map((r) => words(r.role_name));
    const jobIds = [...crew.map((c) => c.job_id), ...entries.map((e) => e.job_id)];
    const [names, statuses] = await Promise.all([jobNames(ctx, jobIds), jobStatuses(ctx, crew.map((c) => str(c.job_id)))]);
    const liveJobs = crew.filter((c) => !["completed", "cancelled"].includes(statuses.get(str(c.job_id)) ?? ""));
    const owed = payments.filter((x) => x.status === "pending").reduce((s, x) => s + Number(x.amount ?? 0), 0);

    const actions: EntityAction[] = [
      {
        id: "rate",
        label: "Set hourly pay",
        input: { type: "number", label: "Dollars an hour", initial: p.pay_rate_per_hour == null ? "" : String(p.pay_rate_per_hour), required: true },
      },
    ];
    const openJobs = await openJobChoices(ctx, crew.map((c) => str(c.job_id)));
    if (openJobs.length) actions.push({ id: "add_job", label: "Put on a job", input: { type: "select", label: "Job", options: openJobs, required: true } });

    return {
      title: str(p.full_name) || str(p.email) || "Team member",
      subtitle: roles.join(" · ") || "No role",
      status: p.trial_crew ? "Trying out" : undefined,
      fields: [
        { label: "Roles", value: roles.join(", ") || "None" },
        { label: "Email", value: str(p.email) },
        { label: "Phone", value: str(p.phone) },
        { label: "Pay", value: payLine(p) },
        { label: "Owed now", value: owed > 0 ? dollars(owed) : "Nothing pending" },
        { label: "Drives for us", value: p.drives_for_company ? "Yes" : "No" },
      ],
      sections: [
        {
          title: "Jobs now",
          rows: liveJobs.map((c) => row(`${names.get(str(c.job_id)) ?? "Job"}${c.is_lead ? " · lead" : ""} · ${JOB_STATUS_WORDS[statuses.get(str(c.job_id)) ?? ""] ?? ""}`, "ops.job", c.job_id)),
          empty: "Not on any open job.",
        },
        {
          title: "Pay periods",
          rows: payments.map((x) => row(`${spanLabel(x.period_start, x.period_end)} · ${dollars(x.amount)} · ${words(x.status)}`, "ops.payment", x.id)),
          empty: "No pay recorded.",
        },
        {
          title: "Recent time",
          rows: entries.map((e) => row(`${stampLabel(e.clocked_in_at)} to ${e.clocked_out_at ? stampLabel(e.clocked_out_at) : "still in"} · ${names.get(str(e.job_id)) ?? "no job"}`, "ops.job", e.job_id)),
          empty: "No time clocked.",
        },
      ],
      actions,
      note: "Roles are changed in Admin › Team & access, not here.",
    };
  },

  async act(ctx, id, action, value) {
    const p = await own(ctx, "profiles", "id, pay_type, commission_pct", id);
    if (!p) return NOT_YOURS;
    switch (action) {
      case "rate": {
        const n = parseNumber(value);
        if (n == null || Number.isNaN(n) || n < 0 || n > 500) return { ok: false, error: "Enter an hourly rate in dollars." };
        // Setting an hourly rate on somebody paid by commission pays them both ways.
        const type = p.pay_type === "commission" ? "both" : p.pay_type === "both" ? "both" : "hourly";
        return attempt(() => updateProfilePay(id, type, n, p.commission_pct == null ? null : Number(p.commission_pct)), `Pay set to ${dollars(n)} an hour.`);
      }
      case "add_job": {
        if (!value) return { ok: false, error: "Pick a job." };
        if (!(await jobNames(ctx, [value])).size) return NOT_YOURS;
        return toResult(await assignCrewMember(value, id), "Added to the crew.");
      }
    }
    return { ok: false, error: "Unknown action." };
  },
};

function payLine(p: Row): string {
  const rate = p.pay_rate_per_hour == null ? null : `${dollars(p.pay_rate_per_hour)}/hour`;
  const commission = p.commission_pct == null ? null : `${Number(p.commission_pct)}% commission`;
  if (p.pay_type === "commission") return commission ?? "Commission, no rate set";
  if (p.pay_type === "both") return [rate, commission].filter(Boolean).join(" + ") || "Not set";
  return rate ?? "Hourly, no rate set";
}

async function jobStatuses(ctx: Parameters<EntityHandler["load"]>[0], ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await ctx.sb.from("jobs").select("id, status").in("id", [...new Set(ids)].slice(0, 300));
  return new Map(((data ?? []) as Row[]).map((j) => [str(j.id), str(j.status)]));
}

/** Signed jobs not yet finished, for "Put on a job". */
async function openJobChoices(ctx: Parameters<EntityHandler["load"]>[0], exclude: string[]): Promise<{ value: string; label: string }[]> {
  try {
    const { data } = await ctx.sb
      .from("jobs")
      .select("id, name, status, project_start_date, property:properties!inner(address, customer:customers!inner(organization_id))")
      .eq("property.customer.organization_id", ctx.organizationId)
      .in("status", ["approved", "in_progress"])
      .order("project_start_date", { ascending: true, nullsFirst: false })
      .limit(60);
    return ((data ?? []) as Row[])
      .filter((j) => !exclude.includes(str(j.id)))
      .map((j) => {
        const addr = str((j.property as Row | null)?.address) || str(j.name);
        return { value: str(j.id), label: `${addr.split(",").slice(0, 2).join(",")}${j.project_start_date ? ` · ${dayLabel(j.project_start_date)}` : ""}` };
      });
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- payment */

const payment: EntityHandler = {
  kind: "ops.payment",

  async load(ctx, id) {
    const x = await own(ctx, "team_payments", "id, profile_id, amount, status, method, period_start, period_end, hours, paid_at, note, created_at", id);
    if (!x) return null;
    const person = await own(ctx, "profiles", "id, full_name, email", str(x.profile_id));
    const name = str(person?.full_name) || str(person?.email) || "Team member";
    const pending = x.status === "pending";
    return {
      title: `${dollars(x.amount)} to ${name}`,
      subtitle: spanLabel(x.period_start, x.period_end),
      status: words(x.status),
      fields: [
        { label: "Amount", value: dollars(x.amount) },
        { label: "Period", value: spanLabel(x.period_start, x.period_end) },
        { label: "Hours", value: x.hours == null ? "" : String(x.hours) },
        { label: "Paid", value: x.paid_at ? `${dayLabel(x.paid_at)}${x.method ? ` by ${words(x.method).toLowerCase()}` : ""}` : "Not yet" },
        { label: "Note", value: str(x.note) },
        { label: "Recorded", value: stampLabel(x.created_at) },
      ],
      sections: person ? [{ title: "Who", rows: [row(name, "ops.crew_member", person.id)] }] : [],
      actions: pending
        ? [
            { id: "paid", label: "Mark paid", tone: "primary", input: { type: "select", label: "How it was paid", options: METHODS, initial: "transfer", required: true } },
            { id: "delete", label: "Delete this entry", tone: "danger", confirm: "Delete this pay entry? Only for one recorded by mistake." },
          ]
        : [],
      note: pending ? undefined : "Paid. Correct a paid entry with an adjusting payment rather than deleting it.",
    };
  },

  async act(ctx, id, action, value) {
    const x = await own(ctx, "team_payments", "id, status", id);
    if (!x) return NOT_YOURS;
    switch (action) {
      case "paid": {
        if (x.status !== "pending") return { ok: false, error: "That one's already paid." };
        const method = METHODS.some((m) => m.value === value) ? (value as "cash" | "check" | "transfer" | "other") : null;
        return toResult(await markTeamPaymentPaid(id, method), "Marked paid.");
      }
      case "delete":
        return toResult(await deleteTeamPayment(id), "Deleted.");
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* ------------------------------------------------------------ applicant */

const applicant: EntityHandler = {
  kind: "ops.applicant",

  async load(ctx, id) {
    const a = await own(ctx, "job_applicants", "id, name, email, phone, zip, position, stage, source, rating, review_note, interview_at, video_link, video_submitted_at, screen_reasons, created_at, decided_at", id);
    if (!a) return null;
    const stage = str(a.stage);
    const moves = applicantMoves(isStage(stage) ? nextStages(stage) : []);
    const actions: EntityAction[] = [];
    if (moves.advance.length) {
      actions.push({
        id: "advance",
        label: "Advance",
        tone: "primary",
        input: { type: "select", label: "To", options: moves.advance.map((s) => ({ value: s, label: stageLabel(s) })), initial: moves.advance[0], required: true },
      });
    }
    if (moves.reject) actions.push({ id: "reject", label: "Reject", tone: "danger", confirm: "Mark this applicant not a fit? No email is sent." });
    actions.push({ id: "rate", label: "Rate", input: { type: "number", label: "1 to 5", initial: a.rating == null ? "" : String(a.rating), required: true } });
    const reasons = Array.isArray(a.screen_reasons) ? (a.screen_reasons as string[]) : [];
    return {
      title: str(a.name) || "Applicant",
      subtitle: words(a.position),
      status: stageLabel(stage),
      fields: [
        { label: "Applied", value: stampLabel(a.created_at) },
        { label: "Heard from", value: str(a.source) },
        { label: "Email", value: str(a.email) },
        { label: "Phone", value: str(a.phone) },
        { label: "ZIP", value: str(a.zip) },
        { label: "Rating", value: a.rating == null ? "Not rated" : `${a.rating} of 5` },
        { label: "Review note", value: str(a.review_note) },
        ...(a.interview_at ? [{ label: "Interview", value: stampLabel(a.interview_at) }] : []),
        ...(a.video_submitted_at ? [{ label: "Video", value: `Sent ${stampLabel(a.video_submitted_at)}` }] : []),
        ...(reasons.length ? [{ label: "Screened out for", value: reasons.join(", ") }] : []),
        ...(a.decided_at ? [{ label: "Decided", value: stampLabel(a.decided_at) }] : []),
      ],
      actions,
      note: "These move the application without emailing anyone. Emails to applicants are written and sent from Hiring.",
    };
  },

  async act(ctx, id, action, value) {
    const a = await own(ctx, "job_applicants", "id, stage, review_note", id);
    if (!a) return NOT_YOURS;
    switch (action) {
      case "advance": {
        const stage = str(a.stage);
        const allowed = applicantMoves(isStage(stage) ? nextStages(stage) : []).advance;
        if (!value || !allowed.includes(value)) return { ok: false, error: "Pick one of the steps offered." };
        return toResult(await setApplicantStage({ id, stage: value }), `Moved to "${stageLabel(value)}".`);
      }
      case "reject":
        return toResult(await setApplicantStage({ id, stage: "not_a_fit" }), "Marked not a fit.");
      case "rate": {
        const n = parseNumber(value);
        if (n == null || Number.isNaN(n) || n < 1 || n > 5) return { ok: false, error: "Rate from 1 to 5." };
        return toResult(await saveApplicantReview({ id, rating: n, note: str(a.review_note) }));
      }
    }
    return { ok: false, error: "Unknown action." };
  },
};

/* --------------------------------------------------------- indeed invite */

const indeedInvite: EntityHandler = {
  kind: "ops.indeed_invite",

  async load(ctx, id) {
    const i = await own(ctx, "indeed_invites", "id, name, position, status, detail, created_at, reminded_at, applicant_id", id);
    if (!i) return null;
    return {
      title: str(i.name) || "Indeed candidate",
      subtitle: words(i.position),
      status: words(i.status),
      fields: [
        { label: "Invited", value: stampLabel(i.created_at) },
        { label: "Reminded", value: i.reminded_at ? stampLabel(i.reminded_at) : "Not yet" },
        { label: "Detail", value: str(i.detail) },
      ],
      sections: [{ title: "Their application", rows: i.applicant_id ? [row("Open the application", "ops.applicant", i.applicant_id)] : [], empty: "They haven't applied yet." }],
      actions: [],
      note: "The invite and its reminder go out on their own. Once they apply, act on the application.",
    };
  },
};

export const OPS_PEOPLE_HANDLERS: EntityHandler[] = [crewMember, payment, applicant, indeedInvite];
