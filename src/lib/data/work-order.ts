import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { buildWorkOrder, type WorkOrder } from "@/lib/work-order";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import { withoutEmpty, type CanvasMark } from "@/lib/canvas-marks";
import type { WorkZone } from "@/components/canvas/types";
import { listJobPhotos, type JobPhotoWithUrl } from "@/lib/data/job-photos";
import { listPhotoWaivers } from "@/lib/data/photo-waivers";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { getProposalForJob } from "@/lib/data/proposals";
import { capabilities } from "@/lib/job-stage";
import type { PhotoWaiver, ZoneRef } from "@/lib/job-lifecycle";
import type { EvaluationStatus, JobStatus, ProposalSiteImageTransform } from "@/types/domain";

export interface WorkOrderPageData {
  /**
   * Everything the photos panel needs.
   *
   * The crew sheet is where a crew stands: it is the screen open on the
   * driveway. Until now it could show the photographs from the evaluation
   * and take none, which meant the people doing the work had no way to
   * record it.
   */
  photos: JobPhotoWithUrl[];
  photoZones: ZoneRef[];
  waivers: PhotoWaiver[];
  jobStatus: JobStatus;
  allowDuring: boolean;
  allowAfter: boolean;
  allowSignOff: boolean;
  signOffLockReason: string | null;
  lockedStageReason: string | null;
  completedAt: string | null;
  completedByName: string | null;
  completionNotes: string | null;
  /** Notes the evaluator pinned to the picture, in the order they are numbered. */
  marks: CanvasMark[];
  order: WorkOrder;
  jobNumber: number | null;
  address: string;
  customerName: string;
  jobName: string;
  siteImagePath: string | null;
  accountManager: { name: string; phone: string | null } | null;
  imageTransform: ProposalSiteImageTransform | null;
}

/**
 * Everything the crew sheet needs, for one job.
 *
 * Shared by the two places that render it: the job page, when the person
 * opening it only works in the field, and its own URL, which is how anybody
 * else looks at the same sheet. One loader rather than two, because the whole
 * point of the second entrance is to see exactly what the crew see — and a
 * second copy of this assembly would drift the first time either changed.
 */
export async function getWorkOrderForJob(jobId: string): Promise<WorkOrderPageData | null> {
  const supabase = await createClient();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select(
      "id, job_number, name, status, property_id, evaluation_status, evaluation_date, completed_at, completion_notes, completed_by, property:properties(address, customers(name))"
    )
    .eq("id", jobId)
    .maybeSingle();

  const job = jobRow as unknown as {
    id: string;
    job_number: number | null;
    name: string;
    status: JobStatus;
    property_id: string;
    evaluation_status: EvaluationStatus;
    evaluation_date: string | null;
    completed_at: string | null;
    completion_notes: string | null;
    completed_by: string | null;
    property: { address: string; customers: { name: string } | null } | null;
  } | null;
  if (!job) return null;

  const [catalog, design, ownerRes, photos, waivers, schedule, proposal] = await Promise.all([
    getCanvasCatalog(),
    getCanvasDesignForJob(jobId),
    supabase.from("properties").select("customers(account_manager_id)").eq("id", job.property_id).maybeSingle(),
    listJobPhotos(jobId).catch(() => []),
    listPhotoWaivers(jobId).catch(() => []),
    getJobSchedule(jobId).catch(() => ({ sessions: [], tickets: [], walkthroughs: [] })),
    getProposalForJob(jobId).catch(() => null),
  ]);

  const accountManagerId =
    (ownerRes.data as unknown as { customers: { account_manager_id: string | null } | null } | null)?.customers
      ?.account_manager_id ?? null;

  // Who the crew ring when something on site doesn't match the sheet.
  const manager = accountManagerId
    ? ((
        await supabase.from("profiles").select("full_name, email, phone").eq("id", accountManagerId).maybeSingle()
      ).data as { full_name: string | null; email: string; phone: string | null } | null)
    : null;

  const zones = design ? (design.zones as unknown as WorkZone[]).filter((z) => z.service) : [];
  // The notes the evaluator pinned to the picture. They are for the crew, so
  // they belong on the crew's sheet as much as on the evaluation.
  const marks = design ? withoutEmpty((design.marks ?? []) as CanvasMark[]) : [];

  const order = buildWorkOrder(zones, catalog, (typeId, key) => {
    const field = serviceTypeById(typeId)?.fields?.find((f) => f.key === key);
    return field?.label ?? key;
  });

  // The same gate the office page uses, from the same rules — the crew must
  // not be offered a different set of stages from the person who scheduled
  // the work.
  const can = capabilities({
    status: job.status,
    evaluationStatus: job.evaluation_status,
    evaluationDate: job.evaluation_date,
    proposalStatus: proposal?.status ?? null,
    sessions: schedule.sessions.map((session) => ({ status: session.status })),
    walkthroughs: schedule.walkthroughs,
  });

  const completedByName = job.completed_by
    ? ((
        await supabase.from("profiles").select("full_name, email").eq("id", job.completed_by).maybeSingle()
      ).data as { full_name: string | null; email: string } | null)
    : null;

  return {
    photos,
    photoZones: zones.map((zone) => ({ id: zone.id, name: zone.name })),
    waivers,
    jobStatus: job.status,
    allowDuring: can.photoDuring.available,
    allowAfter: can.photoAfter.available,
    allowSignOff: can.signOff.available,
    signOffLockReason: can.signOff.available ? null : can.signOff.reason,
    lockedStageReason: can.photoDuring.available ? null : can.photoDuring.reason,
    completedAt: job.completed_at,
    completedByName: completedByName?.full_name || completedByName?.email || null,
    completionNotes: job.completion_notes,
    order,
    jobNumber: job.job_number,
    address: job.property?.address ?? "",
    customerName: job.property?.customers?.name ?? "Client",
    jobName: job.name,
    siteImagePath: design?.image_path ?? null,
    accountManager: manager ? { name: manager.full_name || manager.email, phone: manager.phone } : null,
    imageTransform: design
      ? {
          x: design.image_x,
          y: design.image_y,
          scale: design.image_scale,
          rotation: design.image_rotation,
          canvasWidth: CANVAS_WIDTH,
          canvasHeight: CANVAS_HEIGHT,
        }
      : null,
    marks,
  };
}
