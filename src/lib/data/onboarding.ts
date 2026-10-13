import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { checklistFor, checklistProgress, handlesPesticidesByDefault, isItemOverdue } from "@/lib/hr/onboarding";
import { afterStart, loadBackOfficeSettingsAdmin, type BackOfficeSettings } from "@/lib/data/back-office-settings";
import { tellOwner } from "@/lib/data/back-office-owners";
import { businessToday } from "@/lib/data/compliance";

/**
 * New-hire checklists: created when somebody is hired, tracked per person,
 * overdue items raised to the owner.
 *
 * A hire is either an applicant moved to "hired" in Hiring, or a team member
 * added straight onto the Team page. When an applicant later gets an
 * account, their checklist is linked to it by email rather than a second one
 * made.
 */

type Admin = SupabaseClient;
const admin = (): Admin => createAdminClient() as unknown as Admin;

export const HR_BUCKET = "hr-docs";

async function createChecklist(input: {
  organizationId: string;
  applicantId?: string | null;
  profileId?: string | null;
  name: string;
  email: string | null;
  position: string | null;
  startDate: string;
}): Promise<string | null> {
  const sb = admin();
  const handles = handlesPesticidesByDefault(input.position);
  const { data, error } = await sb
    .from("onboarding_checklists")
    .insert({
      organization_id: input.organizationId,
      applicant_id: input.applicantId ?? null,
      profile_id: input.profileId ?? null,
      person_name: input.name,
      email: input.email,
      position: input.position,
      start_date: input.startDate,
      handles_pesticides: handles,
    })
    .select("id")
    .single();
  // Unique on applicant and on profile: somebody else made it first.
  if (error || !data) return null;
  const id = (data as { id: string }).id;
  const items = checklistFor({ position: input.position, startDate: input.startDate, handlesPesticides: handles });
  await sb.from("onboarding_items").upsert(
    items.map((i) => ({ organization_id: input.organizationId, checklist_id: id, key: i.key, label: i.label, due_on: i.dueOn })),
    { onConflict: "checklist_id,key", ignoreDuplicates: true }
  );
  return id;
}

/**
 * The hiring flow's hook: an applicant was just marked hired. Creates their
 * checklist when the switch is on. Never throws; the daily sweep catches
 * anything this misses.
 */
export async function onApplicantHired(organizationId: string, applicantId: string): Promise<void> {
  try {
    const settings = await loadBackOfficeSettingsAdmin(organizationId);
    if (!settings.onboardingOn || !settings.onboardingStartedAt) return;
    await sweepOnboarding(organizationId, settings);
  } catch (err) {
    log.warn("onboarding.hook_failed", { applicantId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Make checklists for everybody hired since the switch went on, link
 * accounts to applicant checklists by email, and tell the owner about
 * overdue items once each. Idempotent.
 */
export async function sweepOnboarding(organizationId: string, settings: BackOfficeSettings, now = new Date()): Promise<{ created: number; overdue: number }> {
  if (!settings.onboardingOn || !settings.onboardingStartedAt) return { created: 0, overdue: 0 };
  const started = settings.onboardingStartedAt;
  const sb = admin();
  const [applicantsRes, profilesRes, existingRes] = await Promise.all([
    sb.from("job_applicants").select("id, name, email, position, decided_at").eq("organization_id", organizationId).eq("stage", "hired").gte("decided_at", started),
    sb.from("profiles").select("id, full_name, email, created_at").eq("organization_id", organizationId).gte("created_at", started),
    sb.from("onboarding_checklists").select("id, applicant_id, profile_id, email").eq("organization_id", organizationId),
  ]);
  const existing = (existingRes.data ?? []) as { id: string; applicant_id: string | null; profile_id: string | null; email: string | null }[];
  const haveApplicant = new Set(existing.map((c) => c.applicant_id).filter(Boolean));
  const haveProfile = new Set(existing.map((c) => c.profile_id).filter(Boolean));
  let created = 0;

  for (const a of (applicantsRes.data ?? []) as { id: string; name: string; email: string; position: string; decided_at: string }[]) {
    if (haveApplicant.has(a.id)) continue;
    const id = await createChecklist({ organizationId, applicantId: a.id, name: a.name, email: a.email, position: a.position, startDate: businessToday(new Date(a.decided_at)) });
    if (id) {
      created++;
      existing.push({ id, applicant_id: a.id, profile_id: null, email: a.email });
    }
  }

  for (const p of (profilesRes.data ?? []) as { id: string; full_name: string | null; email: string | null; created_at: string }[]) {
    if (haveProfile.has(p.id) || !afterStart(p.created_at, started)) continue;
    const email = (p.email ?? "").toLowerCase();
    const match = email ? existing.find((c) => !c.profile_id && (c.email ?? "").toLowerCase() === email) : undefined;
    if (match) {
      await sb.from("onboarding_checklists").update({ profile_id: p.id }).eq("id", match.id).is("profile_id", null);
      match.profile_id = p.id;
      continue;
    }
    const { data: roles } = await sb.from("profile_roles").select("role_name").eq("profile_id", p.id);
    const names = ((roles ?? []) as { role_name: string }[]).map((r) => r.role_name.toLowerCase());
    // A new owner-level account is not a hire.
    if (names.some((r) => r === "admin" || r === "owner")) continue;
    const position = names.includes("project lead") ? "project-lead" : names.includes("account manager") ? "account-manager" : names.includes("evaluator") ? "evaluator" : "project-technician";
    const id = await createChecklist({ organizationId, profileId: p.id, name: p.full_name || p.email || "New hire", email: p.email, position, startDate: businessToday(new Date(p.created_at)) });
    if (id) created++;
  }

  // Overdue items: one alert each, ever.
  const today = businessToday(now);
  const { data: open } = await sb
    .from("onboarding_items")
    .select("id, label, due_on, done_at, waived, checklist:onboarding_checklists(person_name)")
    .eq("organization_id", organizationId)
    .is("done_at", null)
    .eq("waived", false)
    .lt("due_on", today);
  let overdue = 0;
  for (const item of (open ?? []) as unknown as { id: string; label: string; due_on: string; checklist: { person_name: string } | null }[]) {
    overdue++;
    await tellOwner(
      organizationId,
      `Overdue for ${item.checklist?.person_name ?? "a new hire"}: ${item.label} was due ${item.due_on}. Admin › Team & access.`,
      `onboarding:${item.id}:overdue`
    );
  }
  return { created, overdue };
}

export interface ChecklistView {
  id: string;
  name: string;
  position: string | null;
  startDate: string;
  handlesPesticides: boolean;
  profileId: string | null;
  items: { id: string; key: string; label: string; dueOn: string; doneAt: string | null; waived: boolean; documentPath: string | null; overdue: boolean }[];
  progress: { done: number; total: number; overdue: number; complete: boolean };
}

/** Every checklist not yet finished, plus the last few finished ones, for the panel. */
export async function listChecklists(organizationId: string, now = new Date()): Promise<{ checklists: ChecklistView[]; ready: boolean }> {
  const sb = admin();
  const { data, error } = await sb
    .from("onboarding_checklists")
    .select("id, person_name, position, start_date, handles_pesticides, profile_id, completed_at, onboarding_items(id, key, label, due_on, done_at, waived, document_path)")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false })
    .limit(40);
  if (error) return { checklists: [], ready: false };
  const today = businessToday(now);
  const checklists = ((data ?? []) as unknown as {
    id: string;
    person_name: string;
    position: string | null;
    start_date: string;
    handles_pesticides: boolean;
    profile_id: string | null;
    onboarding_items: { id: string; key: string; label: string; due_on: string; done_at: string | null; waived: boolean; document_path: string | null }[];
  }[]).map((c) => {
    const items = (c.onboarding_items ?? [])
      .map((i) => ({
        id: i.id,
        key: i.key,
        label: i.label,
        dueOn: i.due_on,
        doneAt: i.done_at,
        waived: i.waived,
        documentPath: i.document_path,
        overdue: isItemOverdue({ dueOn: i.due_on, doneAt: i.done_at, waived: i.waived }, today),
      }))
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    return {
      id: c.id,
      name: c.person_name,
      position: c.position,
      startDate: c.start_date,
      handlesPesticides: c.handles_pesticides,
      profileId: c.profile_id,
      items,
      progress: checklistProgress(items, today),
    };
  });
  return { checklists, ready: true };
}
