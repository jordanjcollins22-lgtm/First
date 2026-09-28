import { createClient } from "@/lib/supabase/client";
import { attachJobPhoto } from "@/lib/actions/job-photo-actions";
import { areaPhotoTaken } from "@/lib/actions/area-work-actions";
import { addJobReceipt } from "@/lib/actions/job-receipt-actions";
import { subAttachPhoto, subFinish, subPhotoSlot } from "@/lib/actions/sub-crew-actions";
import { finishIntakePhoto, startIntakePhoto, submitEvaluationIntake } from "@/lib/actions/evaluation-intake-actions";
import { saveCanvasDesign, type SaveCanvasDesignInput } from "@/lib/actions/canvas-design-actions";
import { saveVisitPlan } from "@/lib/actions/evaluation-visit-actions";
import type { PlanItem } from "@/lib/evaluation-visit";
import type { JobPhotoKind } from "@/types/domain";
import { isNoSignal, keepForLater, removeIfPresent, type NewOutboxItem, type OutboxItem } from "@/lib/offline/outbox";

/**
 * Sending what the outbox holds, one kind at a time. The same code sends it
 * the first time, with signal, and later from the outbox, so a photo sent
 * late ends up exactly where one sent at once does.
 */

export type SendOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; noSignal: boolean; message: string };

const refused = (message: string): SendOutcome => ({ ok: false, noSignal: false, message });

/** Puts a file in storage. One already there was sent last time, and only what came after it failed. */
async function put(bucket: string, path: string, blob: Blob, type: string): Promise<SendOutcome | null> {
  const { error } = await createClient().storage.from(bucket).upload(path, blob, { contentType: type || undefined, upsert: false });
  if (!error || /exists|duplicate/i.test(error.message)) return null;
  return { ok: false, noSignal: isNoSignal(error), message: "Couldn't upload the photo." };
}

async function putSigned(bucket: string, path: string, token: string, blob: Blob, type: string): Promise<SendOutcome | null> {
  const { error } = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, blob, { contentType: type || "image/jpeg" });
  if (!error) return null;
  return { ok: false, noSignal: isNoSignal(error), message: "Couldn't upload the photo." };
}

export async function sendItem(item: Pick<OutboxItem, "kind" | "blob" | "type" | "args">): Promise<SendOutcome> {
  const a = item.args;
  try {
    switch (item.kind) {
      case "job-photo": {
        const jobId = String(a.jobId);
        const path = String(a.path);
        const zone = (a.zone as { id: string; name: string } | null) ?? null;
        const failed = await put("job-photos", path, item.blob!, item.type);
        if (failed) return failed;
        const saved = await attachJobPhoto(jobId, path, a.kind as JobPhotoKind, null, zone);
        if (!saved.ok) return refused(saved.message);
        // The prep or after photo that moves an area on.
        if (a.areaDone && zone) await areaPhotoTaken(jobId, zone.id);
        return { ok: true, result: { id: saved.id, path } };
      }
      case "receipt": {
        const path = String(a.path);
        const failed = await put("job-photos", path, item.blob!, item.type);
        if (failed) return failed;
        const saved = await addJobReceipt(String(a.jobId), path, String(a.what), String(a.amount ?? ""));
        return saved.ok ? { ok: true, result: { path } } : refused(saved.message);
      }
      case "sub-photo": {
        const token = String(a.token);
        const slot = await subPhotoSlot(token);
        if (!slot.ok) return refused(slot.message);
        const failed = await putSigned("job-photos", slot.path, slot.uploadToken, item.blob!, item.type);
        if (failed) return failed;
        const saved = await subAttachPhoto(token, String(a.zoneId), slot.path);
        if (!saved.ok) return refused(saved.message);
        if (a.last) {
          const finished = await subFinish(token);
          if (!finished.ok) return refused(finished.message);
        }
        return { ok: true, result: { path: slot.path } };
      }
      case "intake-photo": {
        const token = String(a.token);
        const area = String(a.area);
        const slot = await startIntakePhoto({ token, area, type: item.type, size: item.blob!.size });
        if (!slot.ok) return refused(slot.error);
        const failed = await putSigned("job-photos", slot.path, slot.uploadToken, item.blob!, item.type);
        if (failed) return failed;
        const saved = await finishIntakePhoto({ token, area, path: slot.path });
        return saved.ok ? { ok: true, result: { path: saved.path, url: saved.url, area } } : refused(saved.error);
      }
      case "intake-submit": {
        const sent = await submitEvaluationIntake({ token: String(a.token), answers: a.answers, together: Boolean(a.together) });
        return sent.ok ? { ok: true, result: { submittedAt: sent.submittedAt } } : refused(sent.error);
      }
      case "zone-photo": {
        const failed = await put("canvas-images", String(a.path), item.blob!, item.type);
        return failed ?? { ok: true, result: { path: String(a.path) } };
      }
      case "visit-plan": {
        const saved = await saveVisitPlan(String(a.jobId), a.items as PlanItem[]);
        return saved.ok ? { ok: true, result: {} } : refused(saved.message);
      }
      case "site-map": {
        await saveCanvasDesign(String(a.jobId), a.design as SaveCanvasDesignInput);
        return { ok: true, result: {} };
      }
    }
  } catch (error) {
    // A server action with no signal throws before it reaches the server.
    return { ok: false, noSignal: isNoSignal(error), message: "Couldn't send it." };
  }
}

export type SendOrKeep =
  | { status: "sent"; result: Record<string, unknown> }
  /** No signal: kept on the phone, and sent by itself later. */
  | { status: "kept"; item: OutboxItem }
  /** Refused for a reason more signal won't fix. */
  | { status: "refused"; message: string };

/**
 * Sends it now, or, with no signal, keeps it on the phone to send later.
 * Pages use this in place of uploading themselves.
 */
export async function sendOrKeep(item: NewOutboxItem): Promise<SendOrKeep> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "kept", item: await keepForLater(item) };
  const outcome = await sendItem(item);
  if (outcome.ok) {
    // One kept under this id before, with no signal, is older than what was just sent.
    if (item.id) await removeIfPresent(item.id).catch(() => undefined);
    return { status: "sent", result: outcome.result };
  }
  if (outcome.noSignal) return { status: "kept", item: await keepForLater(item) };
  return { status: "refused", message: outcome.message };
}
