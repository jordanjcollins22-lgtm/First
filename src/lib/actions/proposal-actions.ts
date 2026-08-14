"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { computeProposalTotal } from "@/lib/proposal-pricing";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas-dimensions";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Snapshots the current site map into a client-facing proposal — price and
 * scope text are frozen at this moment (see the migration's comment for
 * why). Keeps the same shareable token across regenerations, but resets any
 * prior client response, since a changed scope/price supersedes it.
 */
export async function generateProposal(jobId: string): Promise<{ token: string }> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const [design, catalog, organizationId] = await Promise.all([
    getCanvasDesignForJob(jobId),
    getCanvasCatalog(),
    getCurrentOrganizationId(),
  ]);
  if (!design) throw new Error("No site map has been submitted for this job yet.");

  const zones = (design.zones as unknown as WorkZone[]).filter((z) => z.service);
  if (zones.length === 0) throw new Error("Add at least one work zone with a service before generating a proposal.");

  const { total } = computeProposalTotal(zones, catalog);

  const scopeSnapshot: ProposalZoneSnapshot[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    return {
      zoneName: zone.name,
      serviceLabel: def?.label ?? zone.service?.typeId ?? "Service",
      scopeText: (def?.autoScope?.(zone.service?.values ?? {}) || zone.service?.notes || "").trim(),
      photoPaths: zone.service?.photos ?? [],
      points: zone.points,
      color: zone.color,
    };
  });

  const siteImageTransform: ProposalSiteImageTransform | null = design.image_path
    ? {
        x: design.image_x,
        y: design.image_y,
        scale: design.image_scale,
        rotation: design.image_rotation,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
      }
    : null;

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("job_proposals")
    .select("token")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existingError) throw existingError;
  const token = existing?.token ?? generateToken();

  const { error } = await supabase.from("job_proposals").upsert(
    {
      job_id: jobId,
      organization_id: organizationId,
      token,
      status: "pending",
      total_cost: total,
      scope_snapshot: scopeSnapshot,
      site_image_path: design.image_path,
      site_image_transform: siteImageTransform,
      generated_at: new Date().toISOString(),
      responded_at: null,
      client_response_note: null,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
  return { token };
}
