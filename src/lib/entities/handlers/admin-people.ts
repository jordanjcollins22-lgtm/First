import type { EntityAction, EntityContext, EntityHandler, EntityView } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { fixProfileRoles, openDoc, setOnboardingItem, updateChecklist } from "@/lib/actions/back-office-actions";
import { saveApplicantReview, setApplicantStage } from "@/lib/actions/hiring-actions";
import { editOwnerTask, setOwnerTaskStatus } from "@/lib/actions/owner-task-actions";
import { ROLE_KEY_LABEL } from "@/lib/hr/role-mapping";
import { STAGES, isStage, nextStages } from "@/lib/hiring/screening";
import { positionFor } from "@/lib/hiring/positions";
import { TASK_STATUSES, TASK_STATUS_LABEL } from "@/lib/owner-tasks";
import { roleKeysOf, type RoleKey } from "@/lib/roles";
import { day, isIsoDate, roleChange, usdExact, words } from "@/lib/entities/handlers/admin-format";
import { UNKNOWN, fields, many, num, one, personName, result, str, type Row } from "@/lib/entities/handlers/admin-common";

/**
 * The Admin page's people: everybody who can log in and what role they
 * hold, the account managers, the roles themselves, applicants, new-hire
 * checklists and the owner's own task list.
 */

const PROFILE_COLS = "id, full_name, first_name, last_name, email, phone, pay_type, pay_rate_per_hour, commission_pct, is_affiliate, does_evaluations, trial_crew, created_at";
const FOREVER = "876000h";

async function rolesOf(ctx: EntityContext, profileId: string): Promise<string[]> {
  return (await many(ctx.sb.from("profile_roles").select("role_name").eq("profile_id", profileId))).map((r) => str(r.role_name));
}

async function bannedUntil(ctx: EntityContext, profileId: string): Promise<string | null> {
  try {
    const { data } = await ctx.admin.auth.admin.getUserById(profileId);
    const until = (data?.user as { banned_until?: string | null } | undefined)?.banned_until ?? null;
    return until && new Date(until).getTime() > Date.now() ? until : null;
  } catch {
    return null;
  }
}

async function loadPerson(ctx: EntityContext, id: string, asManager: boolean): Promise<EntityView | null> {
  const sb = ctx.sb;
  const p = await one(sb.from("profiles").select(PROFILE_COLS).eq("id", id).eq("organization_id", ctx.organizationId));
  if (!p) return null;
  const [roles, jobs, customers, checklists, pay, banned] = await Promise.all([
    rolesOf(ctx, id),
    many(sb.from("jobs").select("id, name, status").eq("assigned_to", id).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(25)),
    many(sb.from("customers").select("id, name").eq("account_manager_id", id).eq("organization_id", ctx.organizationId).order("name").limit(25)),
    many(ctx.admin.from("onboarding_checklists").select("id, start_date, completed_at").eq("profile_id", id).eq("organization_id", ctx.organizationId)),
    many(sb.from("team_payments").select("id, amount, period_end").eq("profile_id", id).eq("organization_id", ctx.organizationId).eq("status", "pending")),
    bannedUntil(ctx, id),
  ]);
  const keys = roleKeysOf(roles);
  const self = id === ctx.profileId;

  const actions: EntityAction[] = [
    {
      id: "change_role",
      label: "Change role",
      tone: "primary",
      input: {
        type: "select",
        label: "Role",
        options: (Object.keys(ROLE_KEY_LABEL) as RoleKey[]).map((k) => ({ value: k, label: ROLE_KEY_LABEL[k] })),
        initial: keys[0] ?? "",
        required: true,
      },
    },
  ];
  if (!self) {
    actions.push(
      banned
        ? { id: "reactivate", label: "Let them log in again", confirm: "Let this person log in again? Give them a role afterwards." }
        : { id: "deactivate", label: "Deactivate", tone: "danger", confirm: `Deactivate ${personName(p)}? They can't log in and lose every role.` }
    );
  }

  const customerRows = customers.map((c) => row(str(c.name) || "Customer", "admin.customer", c.id));
  const jobRows = jobs.map((j) => row(`${str(j.name) || "Job"} · ${words(str(j.status))}`, "admin.job", j.id));
  const sections = [
    { title: "Roles", rows: roles.map((r) => row(r, "admin.role", r)), empty: "No role. They see almost nothing." },
    { title: "Customers they manage", rows: customerRows, empty: "None." },
    { title: "Jobs assigned", rows: jobRows, empty: "None." },
    ...(checklists.length ? [{ title: "New-hire checklist", rows: checklists.map((c) => row(`Started ${day(str(c.start_date))}${c.completed_at ? " · complete" : ""}`, "admin.onboarding", c.id)) }] : []),
    ...(pay.length ? [{ title: "Pay waiting", rows: pay.map((t) => row(`${usdExact(num(t.amount))} · to ${day(str(t.period_end))}`, "admin.team_payment", t.id)) }] : []),
  ];
  if (asManager) sections.splice(0, 3, sections[1], sections[2], sections[0]);

  return {
    title: personName(p),
    subtitle: asManager ? "Account manager" : keys.map((k) => ROLE_KEY_LABEL[k]).join(", ") || "No recognised role",
    status: banned ? "Deactivated" : undefined,
    fields: fields([
      ["Email", p.email],
      ["Phone", p.phone],
      ["Pay", p.pay_type ? `${words(str(p.pay_type))}${p.pay_rate_per_hour ? ` · $${num(p.pay_rate_per_hour)}/hr` : ""}${p.commission_pct ? ` · ${num(p.commission_pct)}% commission` : ""}` : ""],
      ["Does evaluations", p.does_evaluations ? "Yes" : ""],
      ["Affiliate", p.is_affiliate ? "Yes" : ""],
      ["Trial crew", p.trial_crew ? "Yes" : ""],
      ["Added", day(str(p.created_at))],
    ]),
    sections,
    actions,
    note: "Change role gives them one of the five roles and takes away every other role name they hold.",
  };
}

async function actPerson(ctx: EntityContext, id: string, action: string, value?: string) {
  const p = await one(ctx.sb.from("profiles").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
  if (!p) return { ok: false as const, error: "Couldn't find that person." };
  const roles = await rolesOf(ctx, id);
  switch (action) {
    case "change_role": {
      if (!value || !(value in ROLE_KEY_LABEL)) return { ok: false as const, error: "Pick a role." };
      const change = roleChange(roles, value as RoleKey);
      if (!change.add.length && !change.remove.length) return { ok: true as const, message: "They already hold just that role." };
      return result(await fixProfileRoles({ profileId: id, ...change }), `Now ${ROLE_KEY_LABEL[value as RoleKey].toLowerCase()}.`);
    }
    case "deactivate": {
      if (id === ctx.profileId) return { ok: false as const, error: "You can't deactivate yourself." };
      const { error } = await ctx.admin.auth.admin.updateUserById(id, { ban_duration: FOREVER });
      if (error) return { ok: false as const, error: error.message };
      if (roles.length) {
        const r = await fixProfileRoles({ profileId: id, add: [], remove: roles });
        if (!r.ok) return { ok: false as const, error: `They can't log in, but their roles stayed: ${r.error}` };
      }
      return { ok: true as const, message: "Deactivated. They can't log in." };
    }
    case "reactivate": {
      const { error } = await ctx.admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      return error ? { ok: false as const, error: error.message } : { ok: true as const, message: "They can log in again. Give them a role." };
    }
  }
  return UNKNOWN;
}

const profileHandler: EntityHandler = {
  kind: "admin.profile",
  load: (ctx, id) => loadPerson(ctx, id, false),
  act: actPerson,
};

const accountManagerHandler: EntityHandler = {
  kind: "admin.account_manager",
  load: (ctx, id) => loadPerson(ctx, id, true),
  act: actPerson,
};

const roleHandler: EntityHandler = {
  kind: "admin.role",
  async load(ctx, id) {
    const people = await many(ctx.sb.from("profiles").select("id, full_name, first_name, last_name, email").eq("organization_id", ctx.organizationId));
    const holders = await many(ctx.sb.from("profile_roles").select("profile_id").eq("role_name", id));
    const holderIds = new Set(holders.map((h) => str(h.profile_id)));
    const members = people.filter((p) => holderIds.has(str(p.id)));
    const others = people.filter((p) => !holderIds.has(str(p.id)));
    const pages = await many(ctx.sb.from("role_permissions").select("tab_key, granted").eq("role_name", id).order("tab_key"));
    const key = roleKeysOf([id])[0];
    return {
      title: id,
      subtitle: key ? `Counts as ${ROLE_KEY_LABEL[key].toLowerCase()}` : "Not one of the five roles",
      fields: [],
      sections: [
        { title: "People with it", rows: members.map((p) => row(personName(p), "admin.profile", p.id)), empty: "Nobody." },
        { title: "Pages it opens", rows: pages.filter((x) => x.granted !== false).map((x) => ({ text: words(str(x.tab_key)) })), empty: "No pages set for it." },
      ],
      actions: others.length
        ? [{ id: "give", label: "Give somebody this role", input: { type: "select", label: "Who", options: others.map((p) => ({ value: str(p.id), label: personName(p) })), required: true } }]
        : [],
      note: key ? undefined : "People holding only this role are listed on Team & access to be given one of the five.",
    };
  },
  async act(ctx, id, action, value) {
    if (action !== "give" || !value) return UNKNOWN;
    const p = await one(ctx.sb.from("profiles").select("id").eq("id", value).eq("organization_id", ctx.organizationId));
    if (!p) return { ok: false, error: "Couldn't find that person." };
    return result(await fixProfileRoles({ profileId: value, add: [id], remove: [] }), "Role given.");
  },
};

/* ------------------------------------------------------------------ */
/* Hiring                                                               */
/* ------------------------------------------------------------------ */

const APPLICANT_COLS = "id, name, email, phone, zip, position, stage, source, rating, review_note, screen_reasons, created_at, interview_at, video_link, video_submitted_at, decided_at";

const applicantHandler: EntityHandler = {
  kind: "admin.applicant",
  async load(ctx, id) {
    const a = await one(ctx.admin.from("job_applicants").select(APPLICANT_COLS).eq("id", id).eq("organization_id", ctx.organizationId));
    if (!a) return null;
    const events = await many(ctx.admin.from("applicant_events").select("at, kind, actor_name").eq("applicant_id", id).order("at", { ascending: false }).limit(20));
    const stage = str(a.stage);
    const next = isStage(stage) ? nextStages(stage) : [];
    const reasons = Array.isArray(a.screen_reasons) ? (a.screen_reasons as string[]) : [];
    const actions: EntityAction[] = [];
    if (next.length) {
      actions.push({ id: "stage", label: "Move along", tone: "primary", input: { type: "select", label: "To", options: next.map((s) => ({ value: s, label: STAGES[s] })), required: true } });
    }
    actions.push(
      { id: "rate", label: "Rate", input: { type: "select", label: "Rating", options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` })), initial: a.rating ? String(a.rating) : "" } },
      { id: "note", label: "Write a note", input: { type: "textarea", label: "Note", initial: str(a.review_note) } }
    );
    return {
      title: str(a.name) || "Applicant",
      subtitle: `${positionFor(str(a.position))?.title ?? words(str(a.position))} · applied ${day(str(a.created_at))}`,
      status: isStage(stage) ? STAGES[stage] : words(stage),
      fields: fields([
        ["Email", a.email],
        ["Phone", a.phone],
        ["ZIP", a.zip],
        ["Came from", a.source],
        ["Rating", a.rating ? `${num(a.rating)} of 5` : ""],
        ["Note", a.review_note],
        ["Didn't pass", reasons.join("; ")],
        ["Video", a.video_link || (a.video_submitted_at ? `Uploaded ${day(str(a.video_submitted_at))}` : "")],
        ["Interview", a.interview_at ? day(str(a.interview_at)) : ""],
      ]),
      sections: [{ title: "What happened", rows: events.map((e) => ({ text: `${day(str(e.at))} · ${words(str(e.kind))}${e.actor_name ? ` · ${str(e.actor_name)}` : ""}` })), empty: "Nothing yet." }],
      actions,
      note: "Moving along here sends nothing; emails to applicants are written and shown before they go, from Hiring.",
    };
  },
  async act(ctx, id, action, value) {
    const a = await one(ctx.admin.from("job_applicants").select("id, rating, review_note").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!a) return { ok: false, error: "Couldn't find that applicant." };
    switch (action) {
      case "stage":
        return result(await setApplicantStage({ id, stage: value ?? "" }), "Moved.");
      case "rate": {
        const rating = value ? Number(value) : null;
        return result(await saveApplicantReview({ id, rating, note: str(a.review_note) }));
      }
      case "note":
        return result(await saveApplicantReview({ id, rating: a.rating == null ? null : num(a.rating), note: value ?? "" }));
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Onboarding                                                           */
/* ------------------------------------------------------------------ */

const itemState = (i: Row) => (i.waived ? "Doesn't apply" : i.done_at ? `Done ${day(str(i.done_at))}` : `Due ${day(str(i.due_on))}`);

const checklistHandler: EntityHandler = {
  kind: "admin.onboarding",
  async load(ctx, id) {
    const c = await one(ctx.admin.from("onboarding_checklists").select("id, person_name, position, start_date, handles_pesticides, profile_id, completed_at").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!c) return null;
    const items = await many(ctx.admin.from("onboarding_items").select("id, label, due_on, done_at, waived").eq("checklist_id", id).order("due_on"));
    const done = items.filter((i) => i.done_at || i.waived).length;
    return {
      title: `${str(c.person_name)}'s paperwork`,
      subtitle: `${words(str(c.position))} · first day ${day(str(c.start_date))}`,
      status: c.completed_at ? "Complete" : `${done} of ${items.length} done`,
      fields: fields([["Handles pesticides", c.handles_pesticides ? "Yes" : "No"]]),
      sections: [
        { title: "Items", rows: items.map((i) => row(`${str(i.label)} · ${itemState(i)}`, "admin.onboarding_item", i.id)) },
        ...(c.profile_id ? [{ title: "Person", rows: [row(str(c.person_name), "admin.profile", c.profile_id)] }] : []),
      ],
      actions: [
        { id: "start", label: "Change first day", input: { type: "date", label: "First day", initial: str(c.start_date), required: true } },
        c.handles_pesticides ? { id: "no_pesticides", label: "Doesn't handle pesticides" } : { id: "pesticides", label: "Handles pesticides" },
      ],
      note: "Due dates follow the first day. Ticked items keep their tick.",
    };
  },
  async act(_ctx, id, action, value) {
    if (action === "start") {
      if (!isIsoDate(value)) return { ok: false, error: "Pick a date." };
      return result(await updateChecklist({ checklistId: id, startDate: value }), "First day changed.");
    }
    if (action === "pesticides" || action === "no_pesticides") return result(await updateChecklist({ checklistId: id, handlesPesticides: action === "pesticides" }), "Saved.");
    return UNKNOWN;
  },
};

const onboardingItemHandler: EntityHandler = {
  kind: "admin.onboarding_item",
  async load(ctx, id) {
    const i = await one(ctx.admin.from("onboarding_items").select("id, checklist_id, label, due_on, done_at, waived, document_path, onboarding_checklists(person_name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!i) return null;
    const closed = Boolean(i.done_at || i.waived);
    const who = str((i.onboarding_checklists as Row | null)?.person_name);
    return {
      title: str(i.label),
      subtitle: who || undefined,
      status: itemState(i),
      fields: fields([["Form on file", i.document_path ? "Yes" : "Not uploaded"]]),
      sections: [{ title: "Checklist", rows: [row(`${who || "Their"} paperwork`, "admin.onboarding", i.checklist_id)] }],
      actions: [
        ...(closed
          ? [{ id: "open", label: "Undo" }]
          : [
              { id: "done", label: "Done", tone: "primary" as const },
              { id: "waived", label: "Doesn't apply" },
            ]),
        ...(i.document_path ? [{ id: "doc", label: "Get a link to the form" }] : []),
      ],
      note: i.document_path ? undefined : "Forms are uploaded from Team & access › Onboarding.",
    };
  },
  async act(_ctx, id, action) {
    if (action === "done" || action === "waived" || action === "open") {
      return result(await setOnboardingItem({ itemId: id, state: action }), action === "done" ? "Ticked." : action === "waived" ? "Marked as not applying." : "Reopened.");
    }
    if (action === "doc") {
      const r = await openDoc({ area: "onboarding", id });
      return r.ok ? { ok: true, message: `Good for 10 minutes: ${r.url}` } : { ok: false, error: r.error };
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Owner tasks                                                          */
/* ------------------------------------------------------------------ */

const ownerTaskHandler: EntityHandler = {
  kind: "admin.owner_task",
  async load(ctx, id) {
    const t = await one(ctx.sb.from("owner_tasks").select("id, section, title, note, status, done_at, updated_at").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!t) return null;
    const status = str(t.status) as (typeof TASK_STATUSES)[number];
    return {
      title: str(t.title),
      subtitle: str(t.section),
      status: TASK_STATUS_LABEL[status] ?? words(status),
      fields: fields([
        ["Note", t.note],
        ["Done", t.done_at ? day(str(t.done_at)) : ""],
        ["Last changed", day(str(t.updated_at))],
      ]),
      actions: [
        { id: "status", label: "Change status", tone: "primary", input: { type: "select", label: "Status", options: TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] })), initial: status, required: true } },
        ...(status !== "done" ? [{ id: "done", label: "Tick it off" }] : []),
        { id: "note", label: "Edit the note", input: { type: "textarea", label: "Note", initial: str(t.note) } },
        { id: "rename", label: "Rename", input: { type: "text", label: "Title", initial: str(t.title), required: true } },
      ],
    };
  },
  async act(_ctx, id, action, value) {
    switch (action) {
      case "status":
        return result(await setOwnerTaskStatus(id, value ?? ""));
      case "done":
        return result(await setOwnerTaskStatus(id, "done"));
      case "note":
        return result(await editOwnerTask(id, { note: value ?? "" }));
      case "rename":
        return result(await editOwnerTask(id, { title: value ?? "" }));
    }
    return UNKNOWN;
  },
};

export const ADMIN_PEOPLE_HANDLERS: EntityHandler[] = [
  profileHandler,
  accountManagerHandler,
  roleHandler,
  applicantHandler,
  checklistHandler,
  onboardingItemHandler,
  ownerTaskHandler,
];
