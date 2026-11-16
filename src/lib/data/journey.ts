import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { businessToday } from "@/lib/data/compliance";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { PHASES, type ReviewDay, type Taper } from "@/lib/hiring/journey";
import { hasRole, isOwnerLevel } from "@/lib/roles";
import { recordingUrls } from "@/lib/data/recordings";

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
  /** The recorded call, ready to play for the next hour. */
  recordingUrl?: string | null;
}

/** An email or reply between us and the new hire that went through the app. */
export interface MessageRow {
  at: string;
  direction: "out" | "in";
  what: string;
  subject: string | null;
  body: string | null;
  byName: string | null;
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
  /** Every email and reply with them that went through the app, oldest first. */
  messages: MessageRow[];
}

export async function getJourney(organizationId: string, checklistId: string, now = new Date()): Promise<JourneyView | null> {
  const sb = admin();
  const { data } = await sb
    .from("onboarding_checklists")
    .select("id, person_name, position, start_date, profile_id, buddy_name, owns_checklists, applicant_id")
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
    applicant_id: string | null;
  };
  const { data: rows } = await sb
    .from("new_hire_steps")
    .select("kind, key, done_at, done_by_name, note, recording_path")
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
  const stepRows = (rows ?? []) as { kind: StepKind; key: string; done_at: string; done_by_name: string | null; note: string | null; recording_path: string | null }[];
  const urls = await recordingUrls(stepRows.map((r) => r.recording_path ?? "")).catch(() => new Map<string, string>());
  return {
    id: c.id,
    name: c.person_name,
    position: c.position,
    startDate: c.start_date,
    profileId: c.profile_id,
    buddyName: c.buddy_name,
    ownsChecklists: c.owns_checklists,
    today: businessToday(now),
    steps: stepRows.map((r) => ({
      kind: r.kind,
      key: r.key,
      doneAt: r.done_at,
      doneByName: r.done_by_name,
      note: r.note,
      recordingUrl: r.recording_path ? (urls.get(r.recording_path) ?? null) : null,
    })),
    taughtOthers,
    tasks: (roleDocFor(c.position)?.tasks ?? []).map((t) => t.key),
    messages: c.applicant_id ? await messagesWith(c.applicant_id) : [],
  };
}

const EMAIL_WHAT: Record<string, string> = {
  interview: "Interview invite",
  skills_question: "Skills question",
  offer: "Offer",
  welcome: "Welcome",
  video_request: "Video request",
  not_a_fit: "Not a fit",
};

/** The emails we sent them and the replies they sent back, from when they applied. */
export async function messagesWith(applicantId: string): Promise<MessageRow[]> {
  const { data } = await admin()
    .from("applicant_events")
    .select("at, kind, detail, actor_name")
    .eq("applicant_id", applicantId)
    .in("kind", ["email_sent", "email_failed", "offer_reply"])
    .order("at", { ascending: true });
  return ((data ?? []) as { at: string; kind: string; detail: Record<string, unknown> | null; actor_name: string | null }[]).map((e) => {
    const d = e.detail ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    if (e.kind === "offer_reply") return { at: e.at, direction: "in" as const, what: "Their reply", subject: null, body: str(d.text), byName: e.actor_name };
    const what = EMAIL_WHAT[String(d.kind ?? "")] ?? "Email";
    return {
      at: e.at,
      direction: "out" as const,
      what: e.kind === "email_failed" ? `${what} (didn't send)` : what,
      subject: str(d.subject),
      body: str(d.body),
      byName: e.actor_name,
    };
  });
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
 * Who can be a new hire's connection (step 13): someone in the same job,
 * so an affiliate connects with another affiliate, a technician with another
 * technician, an account manager with another account manager. Never the
 * owner and never the new hire themselves, so never their boss.
 */
export async function buddyChoices(organizationId: string, exceptProfileId: string | null, position: string | null): Promise<string[]> {
  const sb = admin();
  const { data: people } = await sb.from("profiles").select("id, full_name, is_affiliate").eq("organization_id", organizationId);
  const ids = ((people ?? []) as { id: string }[]).map((p) => p.id);
  const { data: roles } = ids.length ? await sb.from("profile_roles").select("profile_id, role_name").in("profile_id", ids) : { data: [] };
  const held = new Map<string, string[]>();
  for (const r of (roles ?? []) as { profile_id: string; role_name: string }[]) held.set(r.profile_id, [...(held.get(r.profile_id) ?? []), r.role_name]);
  return ((people ?? []) as { id: string; full_name: string | null; is_affiliate: boolean | null }[])
    .filter((p) => p.id !== exceptProfileId && p.full_name?.trim())
    .filter((p) => {
      const r = held.get(p.id) ?? [];
      if (isOwnerLevel(r)) return false;
      if (position === "account-manager") return hasRole(r, "account-manager");
      if (position === "project-technician") return hasRole(r, "project-technician") && !hasRole(r, "account-manager");
      // An affiliate: someone whose job is sending us clients, not a technician or account manager with a link on the side.
      if (position === "affiliate") return !!p.is_affiliate && !hasRole(r, "project-technician") && !hasRole(r, "account-manager");
      return false;
    })
    .map((p) => p.full_name!.trim())
    .sort((a, b) => a.localeCompare(b));
}
