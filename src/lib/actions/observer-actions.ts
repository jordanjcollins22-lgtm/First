"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { RELATIONSHIPS, type ObserverRelationship } from "@/lib/observers";

export type ObserverResult = { ok: true; message?: string } | { ok: false; message: string };

function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Adds somebody to a project as a watcher.
 *
 * They get a link, not an account. A property manager who wants to see how a
 * job is going is not going to accept an invite and set a password to look at
 * a page twice, and making them a customer would put a stranger in every
 * contact picker and every count of our clients.
 *
 * Contact details are optional on purpose: the office often has a phone number
 * and no email, and refusing to record a watcher over a missing field helps
 * nobody. The link works either way.
 */
export async function addObserver(
  jobId: string,
  input: { name: string; email?: string; phone?: string; relationship: ObserverRelationship }
): Promise<ObserverResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const name = input.name.trim();
    if (!name) return { ok: false, message: "Give them a name." };
    if (!RELATIONSHIPS.some((r) => r.value === input.relationship)) {
      return { ok: false, message: "Pick what they are to this project." };
    }

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);

    const { error } = await supabase.from("job_observers").insert({
      organization_id: organizationId,
      job_id: jobId,
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      relationship: input.relationship,
      token: generateToken(),
      added_by: profile.id,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, message: "Added. Send them the link." };
  } catch (err) {
    console.error("addObserver failed:", err);
    return { ok: false, message: "Couldn't add them." };
  }
}

/**
 * Turns a watcher's link off.
 *
 * Revoked rather than deleted, so the record of who had access and when it
 * ended survives. A management company that changes hands is exactly the case
 * where somebody will want to know later who could see what.
 */
export async function revokeObserver(jobId: string, observerId: string): Promise<ObserverResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("job_observers")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", observerId)
      .eq("job_id", jobId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, message: "Their link no longer works." };
  } catch (err) {
    console.error("revokeObserver failed:", err);
    return { ok: false, message: "Couldn't turn that link off." };
  }
}

/** Gives somebody their access back without making them a new row, so the
 * history of the original stays intact. */
export async function restoreObserver(jobId: string, observerId: string): Promise<ObserverResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("job_observers")
      .update({ revoked_at: null })
      .eq("id", observerId)
      .eq("job_id", jobId);
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, message: "Their link works again." };
  } catch (err) {
    console.error("restoreObserver failed:", err);
    return { ok: false, message: "Couldn't turn that link back on." };
  }
}
