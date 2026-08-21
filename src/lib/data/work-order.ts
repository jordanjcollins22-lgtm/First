import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { buildWorkOrder, type WorkOrder } from "@/lib/work-order";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalSiteImageTransform } from "@/types/domain";

export interface WorkOrderPageData {
  order: WorkOrder;
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
    .select("id, name, property_id, property:properties(address, customers(name))")
    .eq("id", jobId)
    .maybeSingle();

  const job = jobRow as unknown as {
    id: string;
    name: string;
    property_id: string;
    property: { address: string; customers: { name: string } | null } | null;
  } | null;
  if (!job) return null;

  const [catalog, design, ownerRes] = await Promise.all([
    getCanvasCatalog(),
    getCanvasDesignForJob(jobId),
    supabase.from("properties").select("customers(account_manager_id)").eq("id", job.property_id).maybeSingle(),
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

  const order = buildWorkOrder(zones, catalog, (typeId, key) => {
    const field = serviceTypeById(typeId)?.fields?.find((f) => f.key === key);
    return field?.label ?? key;
  });

  return {
    order,
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
  };
}
