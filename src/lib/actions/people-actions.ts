"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { sendOutbound } from "@/lib/email/outbound";
import { refuseInDemo } from "@/lib/demo-mode";
import { PEOPLE_BUCKET, alertOwners, assignPositionModules, enterStage, logPersonEvent, peopleAdmin, getPerson, type PersonRow } from "@/lib/data/people";
import {
  EVALUATION_OUTCOME,
  INTERVIEW_CRITERIA,
  INTERVIEW_OUTCOME,
  PERFORMANCE_KINDS,
  ROLE_LABEL,
  ROLE_PATH,
  isPersonStage,
  lines,
  missingForNext,
  nextStage,
  type EvaluationOutcome,
  type InterviewOutcome,
  type PerformanceKind,
} from "@/lib/people/lifecycle";

/** Everything done to a People record. Each action checks the People tab itself and records who did it. */

export type PeopleResult = { ok: true; message?: string } | { ok: false; message: string };
type Manager = { id: string; full_name: string | null; organization_id: string };

async function manager(): Promise<Manager | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("people")) return null;
  return profile as Manager;
}

const DENIED: PeopleResult = { ok: false, message: "Only someone with the People tab can do that." };
const FAILED: PeopleResult = { ok: false, message: "Couldn't save that. Try again." };

async function load(org: string, id: string): Promise<PersonRow | null> {
  const { data } = await peopleAdmin().from("people").select("*").eq("organization_id", org).eq("id", id).maybeSingle();
  return (data as PersonRow | null) ?? null;
}

function refresh(id?: string) {
  revalidatePath("/admin/people");
  if (id) revalidatePath(`/admin/people/${id}`);
}

export async function setPersonOwner(input: { id: string; ownerId: string | null }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const sb = peopleAdmin();
  if (!(await load(me.organization_id, input.id))) return FAILED;
  if (input.ownerId) {
    const { data } = await sb.from("profiles").select("id").eq("organization_id", me.organization_id).eq("id", input.ownerId).maybeSingle();
    if (!data) return FAILED;
  }
  const { error } = await sb.from("people").update({ owner_id: input.ownerId }).eq("id", input.id);
  if (error) return FAILED;
  await logPersonEvent(sb, input.id, "owner_changed", { owner_id: input.ownerId }, me);
  refresh(input.id);
  return { ok: true, message: "Saved." };
}

export async function setItemDone(input: { personId: string; itemId: string; done: boolean; note?: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const sb = peopleAdmin();
  const { data: item } = await sb.from("person_items").select("id, label, person_id").eq("id", input.itemId).eq("person_id", input.personId).eq("organization_id", me.organization_id).maybeSingle();
  if (!item) return FAILED;
  const now = new Date().toISOString();
  const { error } = await sb
    .from("person_items")
    .update(input.done ? { done_at: now, done_by: me.id, done_by_name: me.full_name, note: input.note?.trim().slice(0, 1000) || null } : { done_at: null, done_by: null, done_by_name: null })
    .eq("id", input.itemId);
  if (error) return FAILED;
  await logPersonEvent(sb, input.personId, input.done ? "item_done" : "item_reopened", { label: (item as { label: string }).label }, me);
  refresh(input.personId);
  return { ok: true };
}

export async function advancePerson(input: { id: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const detail = await getPerson(me.organization_id, input.id);
  if (!detail) return FAILED;
  const to = nextStage(detail.person.stage);
  if (!to) return { ok: false, message: "That move happens from Hiring or through a decision." };
  const gaps = missingForNext({
    stage: detail.person.stage,
    status: detail.person.status,
    hasProfile: Boolean(detail.person.profile_id),
    items: detail.items,
    assignments: detail.assignments,
    competencies: detail.competencies.filter((c) => !c.revoked_at).map((c) => c.competency_key),
  });
  if (gaps.length) return { ok: false, message: `Still needed: ${gaps.slice(0, 3).join("; ")}${gaps.length > 3 ? `, and ${gaps.length - 3} more` : ""}` };
  const sb = peopleAdmin();
  await enterStage(sb, detail.person, to, me);
  if (to === "evaluation") await alertOwners(me.organization_id, `Evaluation needed: ${detail.person.full_name}`, `${detail.person.full_name} finished training and is ready to be evaluated on observed work.`);
  refresh(input.id);
  return { ok: true, message: "Moved." };
}

export async function saveScorecard(input: { personId: string; scores: Record<string, { score: number; note: string }>; notes: string; outcome: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person || person.stage !== "interview" || person.status !== "active") return { ok: false, message: "They aren't at the interview stage." };
  if (!(input.outcome in INTERVIEW_OUTCOME)) return { ok: false, message: "Choose an outcome." };
  const scores: Record<string, { score: number; note: string }> = {};
  for (const c of INTERVIEW_CRITERIA) {
    const v = input.scores[c];
    if (!v || !(v.score >= 1 && v.score <= 5)) return { ok: false, message: `Score ${c}.` };
    scores[c] = { score: Math.round(v.score), note: (v.note ?? "").trim().slice(0, 1000) };
  }
  const sb = peopleAdmin();
  const { data: app } = await sb.from("job_applicants").select("id").eq("person_id", person.id).eq("stage", "interview").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const applicantId = (app as { id: string } | null)?.id ?? null;
  const outcome = input.outcome as InterviewOutcome;
  const { error } = await sb.from("interview_scorecards").insert({
    organization_id: me.organization_id,
    person_id: person.id,
    applicant_id: applicantId,
    interviewer_id: me.id,
    interviewer_name: me.full_name,
    scores,
    notes: input.notes.trim().slice(0, 4000) || null,
    outcome,
  });
  if (error) return FAILED;
  await logPersonEvent(sb, person.id, "scorecard", { outcome }, me);
  if (outcome === "advance") {
    if (applicantId) {
      await sb.from("job_applicants").update({ stage: "offer", updated_at: new Date().toISOString() }).eq("id", applicantId);
      await sb.from("applicant_events").insert({ applicant_id: applicantId, kind: "stage_changed", detail: { from: "interview", to: "offer" }, actor: me.id, actor_name: me.full_name });
    }
    await enterStage(sb, person, "job_offer", me);
  }
  refresh(person.id);
  revalidatePath("/admin/hiring");
  if (outcome === "decline") return { ok: true, message: "Saved. Open their application to send the decline email or mark them Not a fit." };
  return { ok: true, message: outcome === "advance" ? "Advanced to Job Offer." : "Saved. They stay at Interview until the next one." };
}

export interface OfferInput {
  personId: string;
  position: string;
  compensation: string;
  classification: string;
  schedule: string;
  responsibilities: string;
  transportation: string;
  startDate: string;
  agreements: string;
}

export async function saveOffer(input: OfferInput): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person || person.stage !== "job_offer" || person.status !== "active") return { ok: false, message: "They aren't at the job offer stage." };
  const required = { Position: input.position, Compensation: input.compensation, Schedule: input.schedule, Responsibilities: input.responsibilities, "Transportation and equipment": input.transportation, "Start date": input.startDate };
  const blank = Object.entries(required).filter(([, v]) => !v.trim()).map(([k]) => k);
  if (blank.length) return { ok: false, message: `Fill in: ${blank.join(", ")}.` };
  if (input.classification !== "employee" && input.classification !== "contractor") return { ok: false, message: "Choose the classification." };
  const sb = peopleAdmin();
  const row = {
    position: input.position.trim(),
    compensation: input.compensation.trim().slice(0, 1000),
    classification: input.classification,
    schedule: input.schedule.trim().slice(0, 1000),
    responsibilities: input.responsibilities.trim().slice(0, 4000),
    transportation: input.transportation.trim().slice(0, 1000),
    start_date: input.startDate,
    agreements: input.agreements.trim().slice(0, 2000) || null,
    updated_at: new Date().toISOString(),
  };
  const { data: open } = await sb.from("job_offers").select("id").eq("person_id", person.id).eq("status", "draft").maybeSingle();
  const { error } = open
    ? await sb.from("job_offers").update(row).eq("id", (open as { id: string }).id)
    : await sb.from("job_offers").insert({ ...row, organization_id: me.organization_id, person_id: person.id, created_by: me.id });
  if (error) return FAILED;
  await sb.from("people").update({ classification: input.classification, position: row.position }).eq("id", person.id);
  await logPersonEvent(sb, person.id, "offer_saved", { position: row.position, classification: row.classification }, me);
  refresh(person.id);
  return { ok: true, message: "Offer saved." };
}

export async function sendOffer(input: { personId: string; offerId: string; subject: string; body: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  await refuseInDemo();
  const person = await load(me.organization_id, input.personId);
  if (!person?.email) return { ok: false, message: "There's no email on their record." };
  const sb = peopleAdmin();
  const { data } = await sb.from("job_offers").select("status").eq("id", input.offerId).eq("person_id", person.id).maybeSingle();
  if ((data as { status: string } | null)?.status !== "draft") return { ok: false, message: "That offer has already gone out." };
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (!subject || !body) return { ok: false, message: "The email is empty." };
  const { data: org } = await sb.from("organizations").select("name").eq("id", me.organization_id).maybeSingle();
  const sent = await sendOutbound({ organizationId: me.organization_id, to: person.email, toName: person.full_name, subject, text: body, fromName: (org as { name?: string } | null)?.name ?? "JS Landscaping MD" });
  if (!sent.ok) return { ok: false, message: `It didn't send: ${sent.message}` };
  await sb.from("job_offers").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", input.offerId);
  await logPersonEvent(sb, person.id, "offer_sent", { subject }, me);
  refresh(person.id);
  return { ok: true, message: `Sent to ${person.email}.` };
}

/** Their answer. Accepted starts onboarding, with due dates counted from the start date. */
export async function recordOfferResponse(input: { personId: string; offerId: string; response: "accepted" | "declined" | "withdrawn" }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person || person.stage !== "job_offer") return FAILED;
  const sb = peopleAdmin();
  const { data: found } = await sb.from("job_offers").select("id, status, start_date, position, classification").eq("id", input.offerId).eq("person_id", person.id).maybeSingle();
  const offer = found as { id: string; status: string; start_date: string; position: string; classification: string } | null;
  if (!offer || (offer.status !== "sent" && offer.status !== "draft")) return { ok: false, message: "That offer is closed." };
  if (input.response === "accepted" && offer.status !== "sent") return { ok: false, message: "Send the offer before recording an acceptance." };
  const now = new Date().toISOString();
  await sb.from("job_offers").update({ status: input.response, responded_at: now }).eq("id", offer.id);
  await logPersonEvent(sb, person.id, `offer_${input.response}`, null, me);
  const { data: app } = await sb.from("job_applicants").select("id, stage").eq("person_id", person.id).eq("stage", "offer").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const application = app as { id: string; stage: string } | null;
  const appStage = input.response === "accepted" ? "hired" : "withdrawn";
  if (application) {
    await sb.from("job_applicants").update({ stage: appStage, decided_at: now, updated_at: now }).eq("id", application.id);
    await sb.from("applicant_events").insert({ applicant_id: application.id, kind: "stage_changed", detail: { from: "offer", to: appStage }, actor: me.id, actor_name: me.full_name });
  }
  if (input.response === "accepted") {
    const updated = { ...person, position: offer.position, classification: offer.classification };
    await sb.from("people").update({ position: offer.position, classification: offer.classification }).eq("id", person.id);
    await enterStage(sb, updated, "onboarding", me, { startDate: offer.start_date });
    await alertOwners(me.organization_id, `Offer accepted: ${person.full_name}`, `${person.full_name} accepted. Their onboarding checklist is ready, with due dates counted from ${offer.start_date}.`);
  } else {
    await sb.from("people").update({ status: "withdrawn" }).eq("id", person.id);
  }
  refresh(person.id);
  revalidatePath("/admin/hiring");
  return { ok: true, message: input.response === "accepted" ? "Accepted. Onboarding is ready." : "Recorded." };
}

export async function setTrainingStep(input: { personId: string; assignmentId: string; step: "read_at" | "shown_at" | "showed_back_at" | "taught_at"; done: boolean }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  if (!["read_at", "shown_at", "showed_back_at", "taught_at"].includes(input.step)) return FAILED;
  const sb = peopleAdmin();
  const { error, data } = await sb
    .from("training_assignments")
    .update({ [input.step]: input.done ? new Date().toISOString() : null, trainer_name: me.full_name })
    .eq("id", input.assignmentId)
    .eq("person_id", input.personId)
    .eq("organization_id", me.organization_id)
    .select("id")
    .maybeSingle();
  if (error || !data) return FAILED;
  await logPersonEvent(sb, input.personId, "training_step", { step: input.step, done: input.done, assignment: input.assignmentId }, me);
  refresh(input.personId);
  return { ok: true };
}

export async function assignModule(input: { personId: string; moduleId: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const sb = peopleAdmin();
  const { data } = await sb.from("training_modules").select("id, title").eq("organization_id", me.organization_id).eq("id", input.moduleId).maybeSingle();
  if (!data || !(await load(me.organization_id, input.personId))) return FAILED;
  const { error } = await sb.from("training_assignments").upsert({ organization_id: me.organization_id, person_id: input.personId, module_id: input.moduleId }, { onConflict: "person_id,module_id", ignoreDuplicates: true });
  if (error) return FAILED;
  await logPersonEvent(sb, input.personId, "module_assigned", { title: (data as { title: string }).title }, me);
  refresh(input.personId);
  return { ok: true, message: "Assigned." };
}

export async function saveEvaluation(input: { personId: string; moduleId: string | null; subject: string; date: string; results: { criterion: string; met: boolean }[]; notes: string; corrective: string; outcome: string; documentPaths: string[] }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person) return FAILED;
  if (!(input.outcome in EVALUATION_OUTCOME)) return { ok: false, message: "Choose Pass, Needs Improvement, or Fail." };
  const outcome = input.outcome as EvaluationOutcome;
  if (outcome !== "pass" && !input.corrective.trim()) return { ok: false, message: "Write the required corrective actions." };
  const sb = peopleAdmin();
  type EvaluatedModule = { title: string; competency_key: string; competency_label: string };
  const { data: found } = input.moduleId
    ? await sb.from("training_modules").select("title, competency_key, competency_label").eq("organization_id", me.organization_id).eq("id", input.moduleId).maybeSingle()
    : { data: null };
  const mod = (found as EvaluatedModule | null) ?? null;
  if (input.moduleId && !mod) return FAILED;
  const subject = (mod?.title ?? input.subject).trim().slice(0, 200);
  if (!subject) return { ok: false, message: "Say what's being evaluated." };
  if (outcome === "pass" && input.results.some((r) => !r.met)) return { ok: false, message: "A Pass needs every criterion met." };
  const paths = input.documentPaths.filter((p) => p.startsWith(`${person.id}/`));
  const { data: saved, error } = await sb
    .from("evaluations")
    .insert({
      organization_id: me.organization_id,
      person_id: person.id,
      module_id: input.moduleId,
      subject,
      evaluator_id: me.id,
      evaluator_name: me.full_name,
      evaluated_on: input.date || new Date().toISOString().slice(0, 10),
      results: input.results.slice(0, 50),
      notes: input.notes.trim().slice(0, 4000) || null,
      corrective_actions: input.corrective.trim().slice(0, 4000) || null,
      outcome,
      document_paths: paths,
    })
    .select("id")
    .single();
  if (error || !saved) return FAILED;
  await logPersonEvent(sb, person.id, "evaluation", { subject, outcome }, me);
  if (mod) {
    if (outcome === "pass") {
      await sb.from("person_competencies").upsert({ person_id: person.id, competency_key: mod.competency_key, label: mod.competency_label, organization_id: me.organization_id, evaluation_id: (saved as { id: string }).id, verified_by_name: me.full_name, verified_at: new Date().toISOString(), revoked_at: null }, { onConflict: "person_id,competency_key" });
    } else {
      await sb.from("person_competencies").update({ revoked_at: new Date().toISOString() }).eq("person_id", person.id).eq("competency_key", mod.competency_key);
    }
  }
  if (outcome !== "pass") {
    await sb.from("performance_records").insert({ organization_id: me.organization_id, person_id: person.id, kind: "retraining", result: "needs_work", note: `${subject}: ${input.corrective.trim().slice(0, 1000)}`, author_id: me.id, author_name: me.full_name });
  }
  refresh(person.id);
  return { ok: true, message: outcome === "pass" ? (mod ? "Passed. Competency verified." : "Passed.") : "Saved, with corrective actions on their record." };
}

/** A person is sent back to learn it again: the module's show-back and teach steps start over. */
export async function returnToTraining(input: { personId: string; moduleId: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person) return FAILED;
  const sb = peopleAdmin();
  await sb.from("training_assignments").update({ showed_back_at: null, taught_at: null }).eq("person_id", person.id).eq("module_id", input.moduleId);
  if (person.stage === "evaluation") await enterStage(sb, person, "training", me);
  await logPersonEvent(sb, person.id, "corrective_training", { module_id: input.moduleId }, me);
  refresh(person.id);
  return { ok: true, message: "Back in training for that module." };
}

export async function addPerformanceRecord(input: { personId: string; kind: string; result: string; note: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  if (!(input.kind in PERFORMANCE_KINDS)) return { ok: false, message: "Choose what this is about." };
  if (!["good", "needs_work", "note"].includes(input.result)) return { ok: false, message: "Choose a result." };
  const note = input.note.trim().slice(0, 2000);
  if (!note) return { ok: false, message: "Write what happened." };
  if (!(await load(me.organization_id, input.personId))) return FAILED;
  const sb = peopleAdmin();
  const { error } = await sb.from("performance_records").insert({ organization_id: me.organization_id, person_id: input.personId, kind: input.kind as PerformanceKind, result: input.result, note, author_id: me.id, author_name: me.full_name });
  if (error) return FAILED;
  await logPersonEvent(sb, input.personId, "performance", { kind: input.kind, result: input.result }, me);
  refresh(input.personId);
  return { ok: true, message: "Added." };
}

export async function startAdvancement(input: { personId: string; role: string; note: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person || person.status !== "active" || !["deployment", "performance_management"].includes(person.stage)) return { ok: false, message: "Advancement starts once someone is deployed." };
  if (!(ROLE_PATH as readonly string[]).includes(input.role)) return { ok: false, message: "Choose the role." };
  if (!input.note.trim()) return { ok: false, message: "Note the qualifications behind this." };
  const sb = peopleAdmin();
  await sb.from("people").update({ position: input.role }).eq("id", person.id);
  await enterStage(sb, { ...person, position: input.role }, "advancement", me);
  await assignPositionModules(sb, { ...person, position: input.role });
  await logPersonEvent(sb, person.id, "advancement", { role: ROLE_LABEL[input.role as keyof typeof ROLE_LABEL], from: person.position, note: input.note.trim().slice(0, 2000) }, me);
  refresh(person.id);
  return { ok: true, message: "Advancement started." };
}

export async function startOffboarding(input: { personId: string; reason: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const person = await load(me.organization_id, input.personId);
  if (!person || person.status !== "active" || !isPersonStage(person.stage)) return FAILED;
  if (["application", "screening", "interview", "job_offer"].includes(person.stage)) return { ok: false, message: "They were never hired. Close this from Hiring." };
  if (!input.reason.trim()) return { ok: false, message: "Write the reason." };
  const sb = peopleAdmin();
  await enterStage(sb, person, "offboarding", me);
  await logPersonEvent(sb, person.id, "offboarding_started", { reason: input.reason.trim().slice(0, 2000) }, me);
  refresh(person.id);
  return { ok: true, message: "Offboarding started." };
}

export async function finishOffboarding(input: { personId: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  const detail = await getPerson(me.organization_id, input.personId);
  if (!detail || detail.person.stage !== "offboarding") return FAILED;
  const gaps = detail.items.filter((i) => i.stage === "offboarding" && i.required && !i.done_at);
  if (gaps.length) return { ok: false, message: `Still needed: ${gaps.map((g) => g.label).join("; ")}` };
  const sb = peopleAdmin();
  await sb.from("people").update({ status: "offboarded", updated_at: new Date().toISOString() }).eq("id", input.personId);
  await logPersonEvent(sb, input.personId, "offboarded", null, me);
  refresh(input.personId);
  return { ok: true, message: "Offboarded." };
}

const SAFE_EXT = /^(pdf|jpe?g|png|heic|webp|doc|docx|mp4|mov|webm)$/;

/** A signed slot to upload straight to the private bucket, like an applicant's video. */
export async function startPersonUpload(input: { personId: string; fileName: string }): Promise<{ ok: true; path: string; uploadToken: string } | { ok: false; message: string }> {
  const me = await manager();
  if (!me) return { ok: false, message: "Only someone with the People tab can do that." };
  if (!(await load(me.organization_id, input.personId))) return { ok: false, message: "Couldn't find them." };
  const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!SAFE_EXT.test(ext)) return { ok: false, message: "Use a PDF, photo, Word file or video." };
  const path = `${input.personId}/${randomUUID()}.${ext}`;
  const { data, error } = await peopleAdmin().storage.from(PEOPLE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Couldn't start that upload." };
  return { ok: true, path, uploadToken: data.token };
}

export async function attachItemDocument(input: { personId: string; itemId: string; path: string }): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  if (!input.path.startsWith(`${input.personId}/`)) return FAILED;
  const sb = peopleAdmin();
  const { error, data } = await sb.from("person_items").update({ document_path: input.path }).eq("id", input.itemId).eq("person_id", input.personId).eq("organization_id", me.organization_id).select("label").maybeSingle();
  if (error || !data) return FAILED;
  await logPersonEvent(sb, input.personId, "document_added", { label: (data as { label: string }).label }, me);
  refresh(input.personId);
  return { ok: true, message: "File added." };
}

export async function personDocumentUrl(input: { personId: string; path: string }): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const me = await manager();
  if (!me || !input.path.startsWith(`${input.personId}/`) || !(await load(me.organization_id, input.personId))) return { ok: false, message: "You can't open that file." };
  const { data } = await peopleAdmin().storage.from(PEOPLE_BUCKET).createSignedUrl(input.path, 300);
  return data?.signedUrl ? { ok: true, url: data.signedUrl } : { ok: false, message: "Couldn't open that file." };
}

export interface ModuleInput {
  id: string | null;
  title: string;
  purpose: string;
  materials: string;
  safety: string;
  steps: string;
  standards: string;
  mistakes: string;
  demoUrl: string;
  practice: string;
  criteria: string;
  competencyLabel: string;
  positions: string[];
  required: boolean;
  status: string;
}

export async function saveModule(input: ModuleInput): Promise<PeopleResult & { id?: string }> {
  const me = await manager();
  if (!me) return DENIED;
  const title = input.title.trim().slice(0, 150);
  const steps = lines(input.steps);
  const criteria = lines(input.criteria);
  const label = input.competencyLabel.trim().slice(0, 100) || title;
  if (!title || !input.purpose.trim()) return { ok: false, message: "A module needs a title and purpose." };
  if (input.status === "published" && (!steps.length || !criteria.length || !input.practice.trim())) return { ok: false, message: "A published module needs steps, practice requirements and evaluation criteria." };
  if (!["draft", "published", "retired"].includes(input.status)) return FAILED;
  let demo: string | null = null;
  if (input.demoUrl.trim()) {
    try {
      const u = new URL(input.demoUrl.trim());
      if (u.protocol !== "https:") throw new Error();
      demo = u.toString();
    } catch {
      return { ok: false, message: "Use a full https:// link for the demonstration." };
    }
  }
  const row = {
    title,
    purpose: input.purpose.trim().slice(0, 1000),
    materials: lines(input.materials),
    safety: lines(input.safety),
    steps,
    standards: lines(input.standards),
    mistakes: lines(input.mistakes),
    demo_url: demo,
    practice: input.practice.trim().slice(0, 2000),
    criteria,
    competency_label: label,
    positions: input.positions.filter((p) => (ROLE_PATH as readonly string[]).includes(p)),
    required: input.required,
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  const sb = peopleAdmin();
  if (input.id) {
    const { error } = await sb.from("training_modules").update(row).eq("id", input.id).eq("organization_id", me.organization_id);
    if (error) return FAILED;
    revalidatePath("/admin/people/training");
    return { ok: true, message: "Saved.", id: input.id };
  }
  const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
  const { data, error } = await sb
    .from("training_modules")
    .insert({ ...row, organization_id: me.organization_id, module_key: `${key}-${randomUUID().slice(0, 6)}`, competency_key: `${key.replace(/-/g, "_")}_${randomUUID().slice(0, 6)}`, sort: 100 })
    .select("id")
    .single();
  if (error || !data) return FAILED;
  revalidatePath("/admin/people/training");
  return { ok: true, message: "Created.", id: (data as { id: string }).id };
}

export interface TemplateInput {
  id: string | null;
  stage: string;
  part: string | null;
  label: string;
  required: boolean;
  legal: boolean;
  appliesTo: string;
  dueDays: number | null;
  active: boolean;
}

export async function saveTemplate(input: TemplateInput): Promise<PeopleResult> {
  const me = await manager();
  if (!me) return DENIED;
  if (!isPersonStage(input.stage)) return FAILED;
  const label = input.label.trim().slice(0, 300);
  if (!label) return { ok: false, message: "Write the checklist item." };
  if (!["any", "employee", "contractor"].includes(input.appliesTo)) return FAILED;
  const row = { stage: input.stage, part: input.stage === "onboarding" ? input.part : null, label, required: input.required, legal: input.legal, applies_to: input.appliesTo, due_days: input.dueDays, active: input.active };
  const sb = peopleAdmin();
  const { error } = input.id
    ? await sb.from("checklist_templates").update(row).eq("id", input.id).eq("organization_id", me.organization_id)
    : await sb.from("checklist_templates").insert({ ...row, organization_id: me.organization_id, item_key: `custom_${randomUUID().slice(0, 8)}`, sort: 500 });
  if (error) return FAILED;
  revalidatePath("/admin/people/setup");
  return { ok: true, message: "Saved. People already in that stage keep their current checklist." };
}
