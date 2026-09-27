"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { areaState, canFinish, nextStep } from "@/lib/sub-crew";
import type { WorkZone } from "@/components/canvas/types";

export type SubCrewResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Everything a subcontractor does from their crew sheet. They have no login:
 * the token in their link is checked on every call, and opens this one
 * visit and nothing else.
 */
async function visitFor(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_work_sessions")
    .select("id, job_id, organization_id, status, subcontractor_id, sub_picked_up_at, sub_on_way_at, sub_arrived_at, sub_finished_at")
    .eq("crew_token", token)
    .maybeSingle();
  if (!data || !data.subcontractor_id || data.status === "cancelled") return null;
  const { data: sub } = await admin.from("subcontractors").select("name, uses_our_tools").eq("id", data.subcontractor_id).maybeSingle();
  if (!sub) return null;
  return { admin, visit: data, sub };
}

function refresh(token: string, jobId: string) {
  revalidatePath(`/crew/${token}`);
  revalidateJobViews(jobId);
}

/** The next button: picked up at the shop, On my way, or I've arrived. */
export async function subStep(token: string, step: "picked_up" | "on_way" | "arrived"): Promise<SubCrewResult> {
  const found = await visitFor(token);
  if (!found) return { ok: false, message: "This link isn't working. Ask the office for a new one." };
  const { admin, visit, sub } = found;
  const expected = nextStep({
    usesOurTools: sub.uses_our_tools,
    pickedUpAt: visit.sub_picked_up_at,
    onWayAt: visit.sub_on_way_at,
    arrivedAt: visit.sub_arrived_at,
    finishedAt: visit.sub_finished_at,
  });
  if (expected !== step) return { ok: false, message: "That's already done. Reload the page." };

  const now = new Date().toISOString();
  const patch =
    step === "picked_up" ? { sub_picked_up_at: now } : step === "on_way" ? { sub_on_way_at: now } : { sub_arrived_at: now, status: "in_progress" };
  const { error } = await admin.from("job_work_sessions").update(patch).eq("id", visit.id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  // On site, the job is under way, the same as when our crew starts it.
  if (step === "arrived") await admin.from("jobs").update({ status: "in_progress" }).eq("id", visit.job_id).eq("status", "approved");
  refresh(token, visit.job_id);
  return { ok: true };
}

/** Somewhere to put a photo: a one-time upload slot under this job. */
export async function subPhotoSlot(token: string): Promise<SubCrewResult<{ path: string; uploadToken: string }>> {
  const found = await visitFor(token);
  if (!found) return { ok: false, message: "This link isn't working. Ask the office for a new one." };
  const path = `${found.visit.job_id}/sub-${randomUUID()}.jpg`;
  const { data, error } = await found.admin.storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Couldn't get the photo ready. Try again." };
  return { ok: true, path, uploadToken: data.token };
}

/** The during photo (prep done) or the after photo (clean up done) of one area. */
export async function subAttachPhoto(token: string, zoneId: string, kind: "during" | "after", path: string): Promise<SubCrewResult> {
  const found = await visitFor(token);
  if (!found) return { ok: false, message: "This link isn't working. Ask the office for a new one." };
  const { admin, visit } = found;
  if (!path.startsWith(`${visit.job_id}/sub-`)) return { ok: false, message: "That photo doesn't belong to this job." };
  if (!visit.sub_arrived_at) return { ok: false, message: "Tap I've arrived first." };

  const { data: design } = await admin.from("canvas_designs").select("zones").eq("job_id", visit.job_id).maybeSingle();
  const zone = ((design?.zones ?? []) as unknown as WorkZone[]).find((z) => z.id === zoneId);
  if (!zone) return { ok: false, message: "Couldn't find that area." };

  const { error } = await admin.from("job_photos").insert({
    organization_id: visit.organization_id,
    job_id: visit.job_id,
    path,
    kind,
    phase: kind === "during" ? "progress" : "after",
    zone_id: zone.id,
    zone_name: zone.name,
    work_session_id: visit.id,
    uploaded_by: null,
    caption: `From ${found.sub.name}`,
  });
  if (error) return { ok: false, message: "Couldn't save that photo. Try again." };
  refresh(token, visit.job_id);
  return { ok: true };
}

/**
 * We're finished: every area has its after photo, so the account manager
 * is asked to come and walk it. Nothing else is closed from here; the
 * walkthrough decides.
 */
export async function subFinish(token: string): Promise<SubCrewResult> {
  const found = await visitFor(token);
  if (!found) return { ok: false, message: "This link isn't working. Ask the office for a new one." };
  const { admin, visit, sub } = found;
  if (!visit.sub_arrived_at) return { ok: false, message: "Tap I've arrived first." };

  const [{ data: design }, { data: photos }] = await Promise.all([
    admin.from("canvas_designs").select("zones").eq("job_id", visit.job_id).maybeSingle(),
    admin.from("job_photos").select("kind, zone_id").eq("job_id", visit.job_id),
  ]);
  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const verdict = canFinish(zones.map((z) => areaState((photos ?? []).filter((p) => p.zone_id === z.id).map((p) => p.kind))));
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  await admin.from("job_work_sessions").update({ sub_finished_at: visit.sub_finished_at ?? new Date().toISOString() }).eq("id", visit.id);

  // One open request at a time: finishing twice does not ask twice.
  const { data: open } = await admin.from("job_walkthroughs").select("id").eq("job_id", visit.job_id).eq("status", "requested").limit(1);
  if (!open?.length) {
    await admin.from("job_walkthroughs").insert({
      job_id: visit.job_id,
      organization_id: visit.organization_id,
      requested_by: null,
      requested_note: `${sub.name} says they're finished.`,
    });
    const { data: job } = await admin
      .from("jobs")
      .select("name, property:properties(address, customer:customers(account_manager_id))")
      .eq("id", visit.job_id)
      .maybeSingle();
    const property = (job as unknown as { property: { address: string | null; customer: { account_manager_id: string | null } | null } | null } | null)?.property;
    const managerId = property?.customer?.account_manager_id ?? null;
    if (managerId) {
      await notifyTeamMember(managerId, "walkthrough_requests", `${sub.name} is finished at ${property?.address ?? job?.name ?? "the job"}. Time to walk it.`).catch(
        () => null
      );
    }
  }
  refresh(token, visit.job_id);
  return { ok: true };
}
