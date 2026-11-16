"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { refuseInDemo } from "@/lib/demo-mode";
import { log } from "@/lib/log";
import { recordingExists } from "@/lib/data/recordings";
import {
  APPLICANT_CALLS,
  MAX_RECORDING_BYTES,
  RECORDING_BUCKET,
  isApplicantCall,
  isRecordingPathFor,
  recordingExt,
  recordingPrefix,
  type RecordingOwner,
} from "@/lib/hiring/recordings";

/**
 * Recording a hiring call: an interview, a check-in or a review. The browser
 * records and uploads straight to storage through a signed link made here,
 * so a long call never passes through a server action.
 */

type Fail = { ok: false; message: string };

async function hiringProfile() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("hiring")) return null;
  return profile;
}

const sb = (): SupabaseClient => createAdminClient() as unknown as SupabaseClient;

async function ownsTarget(organizationId: string, owner: RecordingOwner, id: string): Promise<boolean> {
  const table = owner === "applicant" ? "job_applicants" : "onboarding_checklists";
  const { data } = await sb().from(table).select("id").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  return !!data;
}

export async function startCallRecording(input: { owner: RecordingOwner; id: string; type: string; size: number }): Promise<{ ok: true; path: string; uploadToken: string } | Fail> {
  await refuseInDemo();
  const profile = await hiringProfile();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can record hiring calls." };
  if (input.owner !== "applicant" && input.owner !== "newhire") return { ok: false, message: "Couldn't find who this call is with." };
  if (!(await ownsTarget(profile.organization_id, input.owner, input.id))) return { ok: false, message: "Couldn't find who this call is with." };
  const ext = recordingExt(input.type);
  if (!ext) return { ok: false, message: "This browser recorded in a format we can't keep. Try Chrome or Safari." };
  if (!(input.size > 0)) return { ok: false, message: "Nothing was recorded. Check the microphone and try again." };
  if (input.size > MAX_RECORDING_BYTES) return { ok: false, message: "That recording is too big to keep in one piece." };
  const path = `${recordingPrefix(profile.organization_id, input.owner, input.id)}${crypto.randomUUID()}.${ext}`;
  const { data, error } = await sb().storage.from(RECORDING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    log.error("hiring.recording_slot_failed", { owner: input.owner, error: error?.message });
    return { ok: false, message: "Couldn't get ready to save the recording. Try again in a moment." };
  }
  return { ok: true, path, uploadToken: data.token };
}

/** Notes from the call guide, one per part, kept short and only the parts written in. */
function cleanNotes(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (/^[a-z-]{1,40}$/.test(k) && typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}

/** An applicant's call, recorded and kept on their page. */
export async function saveApplicantCall(input: { applicantId: string; call: string; path: string; seconds: number; notes?: Record<string, string> }): Promise<{ ok: true } | Fail> {
  await refuseInDemo();
  const profile = await hiringProfile();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can record hiring calls." };
  if (!isApplicantCall(input.call)) return { ok: false, message: "Pick which call this was." };
  if (!(await ownsTarget(profile.organization_id, "applicant", input.applicantId))) return { ok: false, message: "Couldn't find that applicant." };
  if (!isRecordingPathFor(input.path, profile.organization_id, "applicant", input.applicantId)) return { ok: false, message: "That recording isn't from this applicant." };
  if (!(await recordingExists(input.path))) return { ok: false, message: "The recording didn't finish saving. Check the connection and try again." };
  const { error } = await sb()
    .from("applicant_events")
    .insert({
      applicant_id: input.applicantId,
      kind: "call_recorded",
      detail: { call: input.call, label: APPLICANT_CALLS[input.call], path: input.path, seconds: Math.max(0, Math.round(input.seconds || 0)), notes: cleanNotes(input.notes) },
      actor: profile.id,
      actor_name: profile.full_name || null,
    });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath(`/admin/hiring/${input.applicantId}`);
  return { ok: true };
}
