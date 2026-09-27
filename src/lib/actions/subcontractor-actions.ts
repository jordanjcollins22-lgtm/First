"use server";

import { randomBytes } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { canRunJobs } from "@/lib/roles";
import { revalidateJobViews } from "@/lib/revalidate-job";

export type SubResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function mayAssign(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Sign in first.";
  if (!canRunJobs(profile.roles)) return "Only somebody who schedules jobs can do that.";
  return null;
}

/** A subcontractor the business uses, added from the job page when it is first given work. */
export async function createSubcontractor(input: {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  usesOurTools: boolean;
}): Promise<SubResult<{ id: string }>> {
  const denied = await mayAssign();
  if (denied) return { ok: false, message: denied };
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the subcontractor a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcontractors")
    .insert({
      organization_id: await getCurrentOrganizationId(),
      name: name.slice(0, 120),
      contact_name: input.contactName?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      uses_our_tools: input.usesOurTools,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Couldn't add them. Try again." };
  return { ok: true, id: data.id };
}

/**
 * Who does a visit: our crew (null) or a subcontractor. Giving it to a
 * subcontractor makes the link to their crew sheet, and says whether they
 * stop at the shop for our tools or come straight with their own.
 */
export async function assignVisit(sessionId: string, subcontractorId: string | null): Promise<SubResult<{ token: string | null }>> {
  const denied = await mayAssign();
  if (denied) return { ok: false, message: denied };
  const supabase = await createClient();
  const { data: session } = await supabase.from("job_work_sessions").select("id, job_id, crew_token").eq("id", sessionId).maybeSingle();
  if (!session) return { ok: false, message: "Couldn't find that visit." };

  if (!subcontractorId) {
    const { error } = await supabase.from("job_work_sessions").update({ subcontractor_id: null, meet_on_site: false }).eq("id", sessionId);
    if (error) return { ok: false, message: "Couldn't change who does it." };
    revalidateJobViews(session.job_id);
    return { ok: true, token: null };
  }

  const { data: sub } = await supabase.from("subcontractors").select("id, uses_our_tools").eq("id", subcontractorId).maybeSingle();
  if (!sub) return { ok: false, message: "Couldn't find that subcontractor." };
  const token = session.crew_token ?? randomBytes(16).toString("hex");
  const { error } = await supabase
    .from("job_work_sessions")
    .update({ subcontractor_id: sub.id, crew_token: token, meet_on_site: !sub.uses_our_tools })
    .eq("id", sessionId);
  if (error) return { ok: false, message: "Couldn't give it to them." };
  revalidateJobViews(session.job_id);
  return { ok: true, token };
}
