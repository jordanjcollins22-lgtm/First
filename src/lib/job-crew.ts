/**
 * Who is on a job.
 *
 * The roster is the truth and jobs.assigned_to is a projection of it — the
 * lead — kept in step by a database trigger. These are the rules the UI greys
 * buttons out with and the server enforces, in one place so they cannot say
 * different things.
 *
 * Only people holding the crew role can be put on a job: the roster decides
 * whose Today screen the job lands on, and an office-only person there would
 * get a stop they are never going to drive to.
 */

import { isAccountManager, isCrew } from "@/lib/affiliate-roles";
import type { JobCrewMember, JobStatus, Profile } from "@/types/domain";

export interface CrewMemberView {
  profileId: string;
  name: string;
  isLead: boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };

/**
 * The roster, lead first, then alphabetically.
 *
 * A stable order matters more than it looks: the crew list is read at a glance
 * on a phone, and a roster that reshuffles between visits is one nobody trusts
 * to be complete.
 */
export function rosterView(crew: JobCrewMember[], profiles: Profile[]): CrewMemberView[] {
  const nameOf = new Map(profiles.map((p) => [p.id, p.full_name || p.email]));
  return crew
    .map((c) => ({
      profileId: c.profile_id,
      name: nameOf.get(c.profile_id) ?? "Someone",
      isLead: c.is_lead,
    }))
    .sort((a, b) => {
      if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Who can be put on a job: people holding the crew role, minus whoever is
 * already on it.
 *
 * A job's roster decides whose Today screen it lands on, so putting an
 * office-only person there would give them a stop they are never going to
 * drive to. Somebody who does both is fine — they hold the crew role and show
 * up here like anybody else.
 */
export function assignableProfiles(crew: JobCrewMember[], profiles: Profile[]): Profile[] {
  const already = new Set(crew.map((c) => c.profile_id));
  return profiles
    .filter((p) => !already.has(p.id))
    .filter((p) => isCrew(p.roles))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
}

/**
 * Who can be the client's account manager.
 *
 * A separate list from the crew, and a separate role: the account manager owns
 * the client relationship rather than the work, and is the one on commission
 * for it. Somebody holding both roles appears in both lists, which is normal
 * in a business this size.
 */
export function assignableAccountManagers(profiles: Profile[]): Profile[] {
  return profiles
    .filter((p) => isAccountManager(p.roles))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
}

/**
 * Whether somebody can be put on this job.
 *
 * A cancelled job takes nobody new — the work is off, and adding a person to
 * it would put a stop on their day for something nobody is doing. A finished
 * one is history and editing its roster rewrites who did the work.
 */
export function canAssign(
  status: JobStatus,
  crew: JobCrewMember[],
  profileId: string,
  candidate?: Pick<Profile, "roles"> | null
): Verdict {
  if (status === "cancelled") return { ok: false, reason: "This job is cancelled. Reopen it first." };
  if (status === "completed") {
    return { ok: false, reason: "This job is finished — changing the crew now would rewrite who did it." };
  }
  if (crew.some((c) => c.profile_id === profileId)) {
    return { ok: false, reason: "They're already on this job." };
  }
  // Checked as well as filtered from the dropdown, so the rule holds against a
  // stale page or a hand-made request rather than only against the UI.
  if (candidate && !isCrew(candidate.roles)) {
    return { ok: false, reason: "Only people with the crew role can be put on a job." };
  }
  return OK;
}

/**
 * Whether somebody can be taken off.
 *
 * Removing the last person is allowed: a job between crews is a real state,
 * and refusing would mean swapping a crew required adding before removing, in
 * that order, forever.
 */
export function canUnassign(status: JobStatus, crew: JobCrewMember[], profileId: string): Verdict {
  if (status === "completed") {
    return { ok: false, reason: "This job is finished — its crew is part of the record now." };
  }
  if (!crew.some((c) => c.profile_id === profileId)) {
    return { ok: false, reason: "They're not on this job." };
  }
  return OK;
}

/** Whether somebody can be made lead. They have to be on the job first. */
export function canMakeLead(status: JobStatus, crew: JobCrewMember[], profileId: string): Verdict {
  if (status === "completed" || status === "cancelled") {
    return { ok: false, reason: "This job is closed." };
  }
  const member = crew.find((c) => c.profile_id === profileId);
  if (!member) return { ok: false, reason: "Add them to the job first." };
  if (member.is_lead) return { ok: false, reason: "They already lead this job." };
  return OK;
}

/**
 * Who inherits the lead when the current one is removed.
 *
 * Longest-serving of whoever is left. A job with people on it is never
 * unassigned — blanking the lead would drop it out of every list that filters
 * on assignment, which is how a job goes quiet without anybody deciding it
 * should. Mirrors the database trigger.
 */
export function leadAfterRemoval(crew: JobCrewMember[], removedProfileId: string): string | null {
  const rest = crew.filter((c) => c.profile_id !== removedProfileId);
  if (rest.length === 0) return null;
  const existingLead = rest.find((c) => c.is_lead);
  if (existingLead) return existingLead.profile_id;
  return [...rest].sort((a, b) => a.created_at.localeCompare(b.created_at))[0].profile_id;
}
