import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { businessToday } from "@/lib/data/compliance";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { PHASES, type ReviewDay, type Taper } from "@/lib/hiring/journey";
import { hasRole, isOwnerLevel } from "@/lib/roles";

/**
 * A new hire's journey, read from their new-hire checklist and the steps
 * logged against it. Who may see it is checked by the caller.
 */

const admin = (): SupabaseClient => createAdminClient() as unknown as SupabaseClient;

export type StepKind = "checkin" | "review" | "training" | "plan" | "culture" | "connect" | "taper";

export interface StepRow {
  kind: StepKind;
  key: string;
  doneAt: string;
  doneByName: string | null;
  note: string | null;
}

export interface JourneyView {
  id: string;
  name: string;
  position: string | null;
  startDate: string;
  profileId: string | null;
  buddyName: string | null;
  ownsChecklists: boolean;
  today: string;
  steps: StepRow[];
  /** Training sign-offs this person has given someone else. */
  taughtOthers: number;
  tasks: string[];
}

export async function getJourney(organizationId: string, checklistId: string, now = new Date()): Promise<JourneyView | null> {
  const sb = admin();
  const { data } = await sb
    .from("onboarding_checklists")
    .select("id, person_name, position, start_date, profile_id, buddy_name, owns_checklists")
    .eq("organization_id", organizationId)
    .eq("id", checklistId)
    .maybeSingle();
  if (!data) return null;
  const c = data as {
    id: string;
    person_name: string;
    position: string | null;
    start_date: string;
    profile_id: string | null;
    buddy_name: string | null;
    owns_checklists: boolean;
  };
  const { data: rows } = await sb
    .from("new_hire_steps")
    .select("kind, key, done_at, done_by_name, note")
    .eq("checklist_id", c.id)
    .order("done_at", { ascending: true });
  let taughtOthers = 0;
  if (c.profile_id) {
    const { count } = await sb
      .from("new_hire_steps")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("kind", "training")
      .eq("done_by", c.profile_id)
      .neq("checklist_id", c.id)
      .or("key.like.%:demonstrated,key.like.%:duplicated");
    taughtOthers = count ?? 0;
  }
  return {
    id: c.id,
    name: c.person_name,
    position: c.position,
    startDate: c.start_date,
    profileId: c.profile_id,
    buddyName: c.buddy_name,
    ownsChecklists: c.owns_checklists,
    today: businessToday(now),
    steps: ((rows ?? []) as { kind: StepKind; key: string; done_at: string; done_by_name: string | null; note: string | null }[]).map((r) => ({
      kind: r.kind,
      key: r.key,
      doneAt: r.done_at,
      doneByName: r.done_by_name,
      note: r.note,
    })),
    taughtOthers,
    tasks: (roleDocFor(c.position)?.tasks ?? []).map((t) => t.key),
  };
}

export function reviewsDone(steps: StepRow[]): Set<ReviewDay> {
  return new Set(steps.filter((s) => s.kind === "review").map((s) => Number(s.key) as ReviewDay));
}

export function trainingDone(steps: StepRow[]): Set<string> {
  return new Set(steps.filter((s) => s.kind === "training").map((s) => s.key));
}

export interface NewHireLine {
  id: string;
  name: string;
  position: string | null;
  startDate: string;
}

/** Everyone with a new-hire checklist, newest first, for the hiring board. */
export async function listNewHires(organizationId: string): Promise<NewHireLine[] | null> {
  const { data, error } = await admin()
    .from("onboarding_checklists")
    .select("id, person_name, position, start_date")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false })
    .limit(30);
  if (error) return null;
  return ((data ?? []) as { id: string; person_name: string; position: string | null; start_date: string }[]).map((c) => ({
    id: c.id,
    name: c.person_name,
    position: c.position,
    startDate: c.start_date,
  }));
}

/** When each lighter check-in rhythm was started, from the steps logged. */
export function taperFrom(steps: StepRow[]): Taper {
  const out: Taper = {};
  for (const s of steps) {
    if (s.kind === "taper" && (PHASES as readonly string[]).includes(s.key) && s.key !== "twice_daily") out[s.key as keyof Taper] = s.doneAt.slice(0, 10);
  }
  return out;
}

/**
 * Who can be a new hire's buddy: anyone on the team except the owner, the
 * account managers (an affiliate's boss) and the new hire themselves. A buddy
 * is never their boss.
 */
export async function buddyChoices(organizationId: string, exceptProfileId: string | null): Promise<string[]> {
  const sb = admin();
  const { data: people } = await sb.from("profiles").select("id, full_name").eq("organization_id", organizationId);
  const ids = ((people ?? []) as { id: string }[]).map((p) => p.id);
  const { data: roles } = ids.length ? await sb.from("profile_roles").select("profile_id, role_name").in("profile_id", ids) : { data: [] };
  const held = new Map<string, string[]>();
  for (const r of (roles ?? []) as { profile_id: string; role_name: string }[]) held.set(r.profile_id, [...(held.get(r.profile_id) ?? []), r.role_name]);
  return ((people ?? []) as { id: string; full_name: string | null }[])
    .filter((p) => p.id !== exceptProfileId && p.full_name?.trim())
    .filter((p) => {
      const r = held.get(p.id) ?? [];
      return !isOwnerLevel(r) && !hasRole(r, "account-manager");
    })
    .map((p) => p.full_name!.trim())
    .sort((a, b) => a.localeCompare(b));
}
