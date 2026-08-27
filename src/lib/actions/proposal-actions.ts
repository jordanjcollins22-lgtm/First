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
import type { Database } from "@/lib/supabase/database.types";

function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Snapshots the current site map into a proposal awaiting an account
 * manager's approval — price and scope text are frozen at this moment (see
 * the migration's comment for why). Keeps the same shareable token across
 * regenerations, but resets any prior client response and drops it back to
 * "needs_approval", since a changed scope/price has to go through review
 * again before a client sees it.
 *
 * Called automatically the moment an evaluation is submitted
 * (updateEvaluationStatus in job-actions.ts) — an account manager's only
 * input from here is to edit or approve it, never to click "Generate."
 * Silently does nothing if there's no site map or no zone has a service yet
 * (e.g. an evaluation submitted with nothing on it), rather than erroring
 * out the submission that triggered it.
 */
export async function generateProposal(jobId: string): Promise<{ token: string } | null> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const [design, catalog, organizationId] = await Promise.all([
    getCanvasDesignForJob(jobId),
    getCanvasCatalog(),
    getCurrentOrganizationId(),
  ]);
  if (!design) return null;

  const zones = (design.zones as unknown as WorkZone[]).filter((z) => z.service);
  if (zones.length === 0) return null;

  const { total } = computeProposalTotal(zones, catalog);

  const scopeSnapshot: ProposalZoneSnapshot[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    // Priced one area at a time as well as all together, so that a client who
    // later asks to drop an area can be shown the price they were quoted
    // minus that area — rather than whatever today's rate card would say.
    const own = computeProposalTotal([zone], catalog);
    return {
      zoneName: zone.name,
      serviceLabel: def?.label ?? zone.service?.typeId ?? "Service",
      scopeText: (def?.autoScope?.(zone.service?.values ?? {}) || zone.service?.notes || "").trim(),
      photoPaths: zone.service?.photos ?? [],
      points: zone.points,
      color: zone.color,
      priceCents: Math.round(own.total * 100),
      // An hourly rate with no measurement, or a material we have no cost for,
      // means this number is not something the rate card fully produced.
      priceDerived: !own.hasNonFlatRate && !own.hasUnknownMaterialCost,
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
      status: "needs_approval",
      total_cost: total,
      scope_snapshot: scopeSnapshot,
      site_image_path: design.image_path,
      site_image_transform: siteImageTransform,
      generated_at: new Date().toISOString(),
      approved_at: null,
      responded_at: null,
      client_response_note: null,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/proposals");
  return { token };
}

/**
 * An account manager's edits before approving — price, per-zone scope
 * wording, and/or a discount picked from the org's discount catalog.
 * `discountId` is optional so a quick price tweak (e.g. from the Proposals
 * tab) doesn't have to touch it; pass `null` to clear an existing discount.
 * The resolved dollar amount is computed here (percentage-of-subtotal or a
 * flat figure) so display code never has to. Doesn't touch status, so it
 * works whether they're adjusting a draft still awaiting approval or
 * correcting one already sent.
 */
export async function updateProposalDraft(
  jobId: string,
  input: {
    totalCost: number;
    scopeSnapshot: ProposalZoneSnapshot[];
    discountId?: string | null;
  }
) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const supabase = await createClient();
  const patch: Database["public"]["Tables"]["job_proposals"]["Update"] = {
    total_cost: input.totalCost,
    scope_snapshot: input.scopeSnapshot,
  };

  if (input.discountId === null) {
    patch.discount_id = null;
    patch.discount_kind = null;
    patch.discount_value = null;
    patch.discount_amount = 0;
    patch.discount_reason = null;
  } else if (input.discountId !== undefined) {
    const { data: discount, error: discountError } = await supabase
      .from("discounts")
      .select("id, name, kind, value")
      .eq("id", input.discountId)
      .maybeSingle();
    if (discountError) throw discountError;
    if (!discount) throw new Error("That discount no longer exists.");

    patch.discount_id = discount.id;
    patch.discount_kind = discount.kind;
    patch.discount_value = discount.value;
    patch.discount_amount = discount.kind === "percentage" ? (input.totalCost * discount.value) / 100 : discount.value;
    patch.discount_reason = discount.name;
  }

  const { error } = await supabase.from("job_proposals").update(patch).eq("job_id", jobId);
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/proposals");
}

/** The account manager's sign-off — this is what actually makes the
 * proposal visible on its public link. */
export async function approveProposal(jobId: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_proposals")
    .update({ status: "sent", approved_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("status", "needs_approval");
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/proposals");
}
