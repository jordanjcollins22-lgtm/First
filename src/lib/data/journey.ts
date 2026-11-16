import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { businessToday } from "@/lib/data/compliance";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { type ReviewDay } from "@/lib/hiring/journey";

/**
 * A new hire's journey, read from their new-hire checklist and the steps
 * logged against it. Who may see it is checked by the caller.
 */

const admin = (): SupabaseClient => createAdminClient() as unknown as SupabaseClient;

export type StepKind = "checkin" | "review" | "training" | "plan" | "culture" | "connect";

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
