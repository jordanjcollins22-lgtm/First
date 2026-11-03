import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { sendOutbound } from "@/lib/email/outbound";
import { applicationReceivedEmail } from "@/lib/hiring/emails";
import { STARTER_MODULES, STARTER_TEMPLATES } from "@/lib/people/content";
import {
  assignmentEligibility,
  dashboardCounts,
  isPersonStage,
  itemsForPerson,
  lifecycleForApplicant,
  missingForNext,
  nextAction,
  nextStage,
  STAGE_LABEL,
  type AssignmentLike,
  type DashboardCounts,
  type PersonStage,
  type PersonStatus,
  type TemplateLike,
} from "@/lib/people/lifecycle";

/**
 * People, as the pages read it. One record per person, from their first
 * application to advancement or offboarding. Everything goes through the
 * service role after the caller's tab has been checked, like Hiring. Hooks
 * from Hiring and crew assignment never throw away the work they follow:
 * callers catch, and an unset table simply leaves the old behavior in place.
 */

type Admin = SupabaseClient;
export const peopleAdmin = (): Admin => createAdminClient() as unknown as Admin;
export const PEOPLE_BUCKET = "people-docs";

export interface PersonRow {
  id: string;
  organization_id: string;
  profile_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  stage: PersonStage;
  status: PersonStatus;
  classification: string;
  owner_id: string | null;
  stage_entered_at: string;
  created_at: string;
}

export interface ItemRow {
  id: string;
  stage: string;
  item_key: string;
  part: string | null;
  label: string;
  required: boolean;
  legal: boolean;
  due_on: string | null;
  done_at: string | null;
  done_by_name: string | null;
  document_path: string | null;
  note: string | null;
  sort: number;
}

export interface ModuleRow {
  id: string;
  module_key: string;
  title: string;
  purpose: string;
  materials: string[];
  safety: string[];
  steps: string[];
  standards: string[];
  mistakes: string[];
  demo_url: string | null;
  practice: string;
  criteria: string[];
  competency_key: string;
  competency_label: string;
  positions: string[];
  required: boolean;
  status: "draft" | "published" | "retired";
  sort: number;
}

export interface AssignmentRow extends AssignmentLike {
  id: string;
  module_id: string;
  trainer_name: string | null;
  note: string | null;
  module: ModuleRow | null;
}

export interface ScorecardRow {
  id: string;
  interviewer_name: string | null;
  scores: Record<string, { score: number; note: string }>;
  notes: string | null;
  outcome: "advance" | "additional_interview" | "decline";
  created_at: string;
}

export interface OfferRow {
  id: string;
  position: string;
  compensation: string;
  classification: "employee" | "contractor";
  schedule: string;
  responsibilities: string;
  transportation: string;
  start_date: string;
  agreements: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "withdrawn";
  sent_at: string | null;
  responded_at: string | null;
}

export interface EvaluationRow {
  id: string;
  subject: string;
  evaluator_name: string | null;
  evaluated_on: string;
  results: { criterion: string; met: boolean }[];
  notes: string | null;
  corrective_actions: string | null;
  outcome: "pass" | "needs_improvement" | "fail";
  document_paths: string[];
  module_id: string | null;
}

export interface CompetencyRow {
  competency_key: string;
  label: string;
  verified_by_name: string | null;
  verified_at: string;
  revoked_at: string | null;
}

export interface PerformanceRow {
  id: string;
  kind: string;
  result: "good" | "needs_work" | "note";
  note: string;
  author_name: string | null;
  created_at: string;
}

export interface EventRow {
  at: string;
  kind: string;
  detail: Record<string, unknown> | null;
  actor_name: string | null;
}

export interface PersonDetail {
  person: PersonRow;
  applicants: { id: string; position: string; stage: string; created_at: string }[];
  items: ItemRow[];
  assignments: AssignmentRow[];
  scorecards: ScorecardRow[];
  offers: OfferRow[];
  evaluations: EvaluationRow[];
  competencies: CompetencyRow[];
  performance: PerformanceRow[];
  events: EventRow[];
  missing: string[];
  nextAction: string;
  next: PersonStage | null;
  team: { id: string; name: string }[];
  availableModules: { id: string; title: string }[];
}

export async function logPersonEvent(sb: Admin, personId: string, kind: string, detail: Record<string, unknown> | null, actor?: { id: string; full_name: string | null } | null) {
  await sb.from("person_events").insert({ person_id: personId, kind, detail, actor: actor?.id ?? null, actor_name: actor?.full_name ?? null });
}

/** Loaded once, so the editable tables have something in them on the first visit. */
export async function ensureStarterContent(organizationId: string): Promise<void> {
  const sb = peopleAdmin();
  const { count: templates } = await sb.from("checklist_templates").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (!templates) {
    await sb.from("checklist_templates").upsert(STARTER_TEMPLATES.map((t) => ({ ...t, positions: [...t.positions], organization_id: organizationId })), { onConflict: "organization_id,stage,item_key", ignoreDuplicates: true });
  }
  const { count: modules } = await sb.from("training_modules").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (!modules) {
    await sb.from("training_modules").upsert(STARTER_MODULES.map((m) => ({ ...m, organization_id: organizationId })), { onConflict: "organization_id,module_key", ignoreDuplicates: true });
  }
}

async function loadTemplates(sb: Admin, organizationId: string): Promise<TemplateLike[]> {
  const { data } = await sb.from("checklist_templates").select("*").eq("organization_id", organizationId).order("sort");
  return (data ?? []) as TemplateLike[];
}

/** The person's checklist for a stage, plus the published modules for their position when they reach training. */
async function seedStage(sb: Admin, person: Pick<PersonRow, "id" | "organization_id" | "position" | "classification">, stage: PersonStage, startDate: string) {
  await ensureStarterContent(person.organization_id);
  const templates = await loadTemplates(sb, person.organization_id);
  const items = itemsForPerson(templates, { stage, position: person.position, classification: person.classification }, startDate);
  if (items.length) {
    await sb.from("person_items").upsert(
      items.map((t) => ({
        organization_id: person.organization_id,
        person_id: person.id,
        stage,
        item_key: t.item_key,
        part: t.part,
        label: t.label,
        required: t.required,
        legal: t.legal,
        due_on: t.due_on,
        sort: t.sort,
      })),
      { onConflict: "person_id,stage,item_key", ignoreDuplicates: true }
    );
  }
  if (stage === "training") await assignPositionModules(sb, person);
}

export async function assignPositionModules(sb: Admin, person: Pick<PersonRow, "id" | "organization_id" | "position">) {
  const { data } = await sb.from("training_modules").select("id, positions, status").eq("organization_id", person.organization_id).eq("status", "published");
  const ids = ((data ?? []) as { id: string; positions: string[] }[])
    .filter((m) => m.positions.length === 0 || (person.position && m.positions.includes(person.position)))
    .map((m) => m.id);
  if (ids.length) {
    await sb.from("training_assignments").upsert(
      ids.map((module_id) => ({ organization_id: person.organization_id, person_id: person.id, module_id })),
      { onConflict: "person_id,module_id", ignoreDuplicates: true }
    );
  }
}

export async function enterStage(
  sb: Admin,
  person: Pick<PersonRow, "id" | "organization_id" | "position" | "classification" | "stage">,
  stage: PersonStage,
  actor: { id: string; full_name: string | null } | null,
  options?: { startDate?: string; status?: PersonStatus }
) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  await sb.from("people").update({ stage, status: options?.status ?? "active", stage_entered_at: now, updated_at: now }).eq("id", person.id);
  await seedStage(sb, person, stage, options?.startDate ?? today);
  await logPersonEvent(sb, person.id, "stage_changed", { from: person.stage, to: stage }, actor);
}

async function personForEmail(sb: Admin, organizationId: string, email: string): Promise<PersonRow | null> {
  const { data } = await sb.from("people").select("*").eq("organization_id", organizationId).ilike("email", email.trim().toLowerCase()).maybeSingle();
  return (data as PersonRow | null) ?? null;
}

/** A new application: one profile, the confirmation email, and an alert when a person has to decide. */
export async function onApplicationReceived(input: {
  organizationId: string;
  applicantId: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  positionTitle: string;
  business: string;
  businessPhone: string | null;
  needsReview: boolean;
  applicantStage: string;
}): Promise<void> {
  const sb = peopleAdmin();
  const email = input.email.trim().toLowerCase();
  const life = lifecycleForApplicant(input.applicantStage);
  let person = await personForEmail(sb, input.organizationId, email);
  if (!person) {
    const { data } = await sb
      .from("people")
      .insert({ organization_id: input.organizationId, full_name: input.name, email, phone: input.phone, position: input.position, stage: life.stage, status: life.status })
      .select("*")
      .single();
    person = (data as PersonRow | null) ?? null;
    if (person) await logPersonEvent(sb, person.id, "applied", { position: input.position });
  } else {
    // Someone already here applying for another job keeps their place if they're on the team.
    const working = !["application", "screening", "interview", "job_offer"].includes(person.stage) && person.status === "active";
    await sb.from("people").update(working ? { phone: input.phone } : { full_name: input.name, phone: input.phone, position: input.position, stage: life.stage, status: life.status }).eq("id", person.id);
    await logPersonEvent(sb, person.id, "applied", { position: input.position, repeat: true });
  }
  if (person) await sb.from("job_applicants").update({ person_id: person.id }).eq("id", input.applicantId);

  const first = input.name.trim().split(/\s+/)[0] ?? input.name;
  const mail = applicationReceivedEmail({ firstName: first, positionTitle: input.positionTitle, business: input.business, phone: input.businessPhone });
  const sent = await sendOutbound({ organizationId: input.organizationId, to: email, toName: input.name, subject: mail.subject, text: mail.body, fromName: input.business });
  if (!sent.ok) log.warn("people.confirmation_failed", { message: sent.message });
  if (input.needsReview) await alertOwners(input.organizationId, `Application requires review: ${input.name}`, `${input.name} applied for ${input.positionTitle} and needs a person to decide. Open Hiring to review.`);
}

export async function onVideoSubmitted(applicantId: string): Promise<void> {
  const sb = peopleAdmin();
  const { data } = await sb.from("job_applicants").select("organization_id, name, position").eq("id", applicantId).maybeSingle();
  const row = data as { organization_id: string; name: string; position: string } | null;
  if (row) await alertOwners(row.organization_id, `Video to review: ${row.name}`, `${row.name} sent their video for ${row.position.replace(/-/g, " ")}. Open Hiring to watch it.`);
}

/** Hiring moved an application, so the person's place moves with it. */
export async function syncPersonFromApplicant(applicantId: string, applicantStage: string, actor: { id: string; full_name: string | null }): Promise<void> {
  const sb = peopleAdmin();
  const { data } = await sb.from("job_applicants").select("person_id, position").eq("id", applicantId).maybeSingle();
  const row = data as { person_id: string | null; position: string } | null;
  if (!row?.person_id) return;
  const { data: found } = await sb.from("people").select("*").eq("id", row.person_id).maybeSingle();
  const person = found as PersonRow | null;
  if (!person) return;
  const life = lifecycleForApplicant(applicantStage);
  await enterStage(sb, { ...person, position: row.position }, life.stage, actor, { status: life.status });
  await sb.from("people").update({ position: row.position }).eq("id", person.id);
}

/** A team account was made. If they applied, this is the same person. If not, they begin onboarding. */
export async function linkTeamMemberToPerson(input: { organizationId: string; profileId: string; name: string; email: string; phone: string | null }): Promise<void> {
  const sb = peopleAdmin();
  const email = input.email.trim().toLowerCase();
  const person = await personForEmail(sb, input.organizationId, email);
  if (person) {
    await sb.from("people").update({ profile_id: input.profileId }).eq("id", person.id);
    await logPersonEvent(sb, person.id, "account_linked", null);
    return;
  }
  const { data } = await sb
    .from("people")
    .insert({ organization_id: input.organizationId, profile_id: input.profileId, full_name: input.name, email, phone: input.phone, stage: "onboarding", status: "active" })
    .select("*")
    .single();
  if (data) {
    const created = data as PersonRow;
    await seedStage(sb, created, "onboarding", new Date().toISOString().slice(0, 10));
    await logPersonEvent(sb, created.id, "record_created", { from: "team" });
  }
}

/** The rule behind crew assignment. No record, or no table yet, changes nothing. */
export async function assignmentCheck(profileId: string, jobHasCrew: boolean): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = peopleAdmin();
  const { data, error } = await sb.from("people").select("stage, status, full_name").eq("profile_id", profileId).maybeSingle();
  if (error || !data) return { ok: true };
  const row = data as { stage: string; status: PersonStatus; full_name: string };
  if (!isPersonStage(row.stage)) return { ok: true };
  const verdict = assignmentEligibility(row.stage, row.status);
  if (verdict.level === "unsupervised") return { ok: true };
  if (verdict.level === "supervised" && jobHasCrew) return { ok: true };
  return { ok: false, reason: `${row.full_name} can't be put on this job yet. ${verdict.reason}${verdict.level === "supervised" ? " Add the lead first." : ""}` };
}

export async function personIdForApplicant(organizationId: string, applicantId: string): Promise<string | null> {
  const sb = peopleAdmin();
  const { data } = await sb.from("job_applicants").select("person_id").eq("organization_id", organizationId).eq("id", applicantId).maybeSingle();
  return (data as { person_id: string | null } | null)?.person_id ?? null;
}

export interface PeopleListRow {
  id: string;
  name: string;
  position: string | null;
  stage: PersonStage;
  status: PersonStatus;
  nextAction: string;
  overdue: number;
  ownerName: string | null;
  applicantStage: string | null;
  needsAttention: boolean;
  stuckDays: number;
}

export interface PeopleDashboard {
  ready: boolean;
  counts: DashboardCounts;
  people: PeopleListRow[];
}

const EMPTY: DashboardCounts = { newApplicants: 0, awaitingScreening: 0, interviewsPending: 0, offersPending: 0, awaitingOnboarding: 0, inTraining: 0, evaluationsPending: 0, readyForDeployment: 0, requiringAttention: 0 };

/** Someone waiting over a week on a person, or holding an overdue item, needs attention. */
function attention(stage: PersonStage, stuckDays: number, overdue: number, openPerformance: number): boolean {
  if (overdue > 0 || openPerformance > 0) return true;
  if (stage === "performance_management") return false;
  return stuckDays > 7;
}

export async function loadDashboard(organizationId: string): Promise<PeopleDashboard> {
  const sb = peopleAdmin();
  const { data, error } = await sb.from("people").select("*").eq("organization_id", organizationId).order("stage_entered_at");
  if (error) return { ready: false, counts: EMPTY, people: [] };
  const today = new Date().toISOString().slice(0, 10);
  const [items, applicants, profiles, assignments, competencies, perf] = await Promise.all([
    sb.from("person_items").select("person_id, stage, label, required, done_at, due_on").eq("organization_id", organizationId).is("done_at", null),
    sb.from("job_applicants").select("person_id, stage, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    sb.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
    sb.from("training_assignments").select("person_id, read_at, shown_at, showed_back_at, taught_at, training_modules(title, required, competency_key)").eq("organization_id", organizationId),
    sb.from("person_competencies").select("person_id, competency_key, revoked_at").eq("organization_id", organizationId),
    sb.from("performance_records").select("person_id, result, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);
  const itemsBy = groupBy((items.data ?? []) as ({ person_id: string; stage: string; label: string; required: boolean; done_at: string | null; due_on: string | null })[]);
  const appBy = new Map<string, string>();
  for (const a of (applicants.data ?? []) as { person_id: string | null; stage: string }[]) if (a.person_id && !appBy.has(a.person_id)) appBy.set(a.person_id, a.stage);
  const names = new Map(((profiles.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  const asgBy = groupBy(((assignments.data ?? []) as unknown as (Record<string, unknown> & { person_id: string; training_modules: { title: string; required: boolean; competency_key: string } | null })[]));
  const compBy = groupBy(((competencies.data ?? []) as { person_id: string; competency_key: string; revoked_at: string | null }[]).filter((c) => !c.revoked_at));
  const latest = new Map<string, string>();
  for (const p of (perf.data ?? []) as { person_id: string; result: string }[]) if (!latest.has(p.person_id)) latest.set(p.person_id, p.result);

  const people: PeopleListRow[] = ((data ?? []) as PersonRow[]).filter((p) => isPersonStage(p.stage)).map((p) => {
    const open = itemsBy.get(p.id) ?? [];
    const overdue = open.filter((i) => i.due_on && i.due_on < today).length;
    const assignmentFacts = (asgBy.get(p.id) ?? []).map((a) => toAssignmentFacts(a));
    const facts = { stage: p.stage, status: p.status, hasProfile: Boolean(p.profile_id), items: open, assignments: assignmentFacts, competencies: (compBy.get(p.id) ?? []).map((c) => c.competency_key) };
    const stuckDays = Math.floor((Date.now() - Date.parse(p.stage_entered_at)) / 86_400_000);
    const needsWork = latest.get(p.id) === "needs_work";
    return {
      id: p.id,
      name: p.full_name,
      position: p.position,
      stage: p.stage,
      status: p.status,
      nextAction: nextAction(facts),
      overdue,
      ownerName: p.owner_id ? names.get(p.owner_id) ?? null : null,
      applicantStage: appBy.get(p.id) ?? null,
      needsAttention: p.status === "active" && attention(p.stage, stuckDays, overdue, needsWork ? 1 : 0),
      stuckDays,
    };
  });
  const counts = dashboardCounts(people.map((p) => ({ stage: p.stage, status: p.status, applicantStage: p.applicantStage, overdue: p.overdue, openEvaluation: p.stage === "evaluation", needsAttention: p.needsAttention })));
  return { ready: true, counts, people };
}

function groupBy<T extends { person_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(r.person_id, [...(out.get(r.person_id) ?? []), r]);
  return out;
}

function toAssignmentFacts(a: Record<string, unknown> & { training_modules: { title: string; required: boolean; competency_key: string } | null }): AssignmentLike {
  return {
    title: a.training_modules?.title ?? "Training",
    required: a.training_modules?.required ?? true,
    competency_key: a.training_modules?.competency_key ?? "",
    read_at: (a.read_at as string | null) ?? null,
    shown_at: (a.shown_at as string | null) ?? null,
    showed_back_at: (a.showed_back_at as string | null) ?? null,
    taught_at: (a.taught_at as string | null) ?? null,
  };
}

export async function getPerson(organizationId: string, id: string): Promise<PersonDetail | null> {
  const sb = peopleAdmin();
  const { data } = await sb.from("people").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  let person = (data as PersonRow | null) ?? null;
  if (!person || !isPersonStage(person.stage)) return null;

  // An account made before this record, or outside it, is the same person when the email matches.
  if (!person.profile_id && person.email) {
    const { data: profile } = await sb.from("profiles").select("id").eq("organization_id", organizationId).ilike("email", person.email).maybeSingle();
    const match = (profile as { id: string } | null)?.id;
    if (match) {
      const { error } = await sb.from("people").update({ profile_id: match }).eq("id", person.id);
      if (!error) person = { ...person, profile_id: match };
    }
  }
  if (person.stage === "training") await assignPositionModules(sb, person);

  const [applicants, items, assignments, scorecards, offers, evaluations, competencies, performance, events, team, modules] = await Promise.all([
    sb.from("job_applicants").select("id, position, stage, created_at").eq("person_id", id).order("created_at", { ascending: false }),
    sb.from("person_items").select("*").eq("person_id", id).order("sort"),
    sb.from("training_assignments").select("*, training_modules(*)").eq("person_id", id).order("assigned_at"),
    sb.from("interview_scorecards").select("*").eq("person_id", id).order("created_at", { ascending: false }),
    sb.from("job_offers").select("*").eq("person_id", id).order("created_at", { ascending: false }),
    sb.from("evaluations").select("*").eq("person_id", id).order("created_at", { ascending: false }),
    sb.from("person_competencies").select("*").eq("person_id", id).order("verified_at"),
    sb.from("performance_records").select("*").eq("person_id", id).order("created_at", { ascending: false }),
    sb.from("person_events").select("at, kind, detail, actor_name").eq("person_id", id).order("at", { ascending: false }).limit(100),
    sb.from("profiles").select("id, full_name, email").eq("organization_id", organizationId).order("full_name"),
    sb.from("training_modules").select("id, title, status").eq("organization_id", organizationId).eq("status", "published").order("sort"),
  ]);

  const assignmentRows: AssignmentRow[] = ((assignments.data ?? []) as (Record<string, unknown> & { id: string; module_id: string; trainer_name: string | null; note: string | null; training_modules: ModuleRow | null })[]).map((a) => ({
    ...toAssignmentFacts(a),
    id: a.id,
    module_id: a.module_id,
    trainer_name: a.trainer_name,
    note: a.note,
    module: a.training_modules,
  }));
  const itemRows = (items.data ?? []) as ItemRow[];
  const competencyRows = (competencies.data ?? []) as CompetencyRow[];
  const facts = { stage: person.stage, status: person.status, hasProfile: Boolean(person.profile_id), items: itemRows, assignments: assignmentRows, competencies: competencyRows.filter((c) => !c.revoked_at).map((c) => c.competency_key) };
  const assigned = new Set(assignmentRows.map((a) => a.module_id));

  return {
    person,
    applicants: (applicants.data ?? []) as PersonDetail["applicants"],
    items: itemRows,
    assignments: assignmentRows,
    scorecards: (scorecards.data ?? []) as ScorecardRow[],
    offers: (offers.data ?? []) as OfferRow[],
    evaluations: (evaluations.data ?? []) as EvaluationRow[],
    competencies: competencyRows,
    performance: (performance.data ?? []) as PerformanceRow[],
    events: (events.data ?? []) as EventRow[],
    missing: missingForNext(facts),
    nextAction: nextAction(facts),
    next: nextStage(person.stage),
    team: ((team.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => ({ id: p.id, name: p.full_name || p.email })),
    availableModules: ((modules.data ?? []) as { id: string; title: string }[]).filter((m) => !assigned.has(m.id)),
  };
}

export async function listModules(organizationId: string): Promise<ModuleRow[]> {
  const sb = peopleAdmin();
  await ensureStarterContent(organizationId);
  const { data } = await sb.from("training_modules").select("*").eq("organization_id", organizationId).order("sort");
  return (data ?? []) as ModuleRow[];
}

export async function getModule(organizationId: string, id: string): Promise<ModuleRow | null> {
  const sb = peopleAdmin();
  const { data } = await sb.from("training_modules").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  return (data as ModuleRow | null) ?? null;
}

export interface TemplateRow extends TemplateLike {
  id: string;
}

export async function listTemplates(organizationId: string): Promise<TemplateRow[]> {
  const sb = peopleAdmin();
  await ensureStarterContent(organizationId);
  const { data } = await sb.from("checklist_templates").select("*").eq("organization_id", organizationId).order("stage").order("sort");
  return (data ?? []) as TemplateRow[];
}

async function ownerEmails(organizationId: string): Promise<{ email: string; name: string | null }[]> {
  const sb = peopleAdmin();
  const { data: roles } = await sb.from("profile_roles").select("profile_id").in("role_name", ["owner", "admin"]);
  const ids = ((roles ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  if (!ids.length) return [];
  const { data } = await sb.from("profiles").select("email, full_name").eq("organization_id", organizationId).in("id", ids);
  return ((data ?? []) as { email: string | null; full_name: string | null }[]).filter((p) => p.email).map((p) => ({ email: p.email as string, name: p.full_name }));
}

export async function alertOwners(organizationId: string, subject: string, text: string): Promise<void> {
  for (const o of await ownerEmails(organizationId)) {
    const sent = await sendOutbound({ organizationId, to: o.email, toName: o.name ?? undefined, subject, text, fromName: "JS Landscaping People" });
    if (!sent.ok) log.warn("people.alert_failed", { message: sent.message });
  }
}

/** Once a morning, and only when something needs a person: overdue items and people waiting. */
export async function sendPeopleDigest(_admin: unknown, organizationId: string): Promise<{ sent: boolean; attention: number } | null> {
  const dash = await loadDashboard(organizationId);
  if (!dash.ready) return null;
  const needing = dash.people.filter((p) => p.needsAttention);
  if (needing.length === 0) return { sent: false, attention: 0 };
  const lines = needing.slice(0, 40).map((p) => `- ${p.name} (${STAGE_LABEL[p.stage]}${p.overdue ? `, ${p.overdue} overdue` : ""}): ${p.nextAction}`);
  await alertOwners(organizationId, `People needing attention: ${needing.length}`, `These people need action. Open People in the app for details.\n\n${lines.join("\n")}${needing.length > 40 ? `\n\nand ${needing.length - 40} more` : ""}`);
  return { sent: true, attention: needing.length };
}
