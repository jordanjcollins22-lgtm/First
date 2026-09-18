"use server";

import { randomUUID } from "node:crypto";
import { revalidateJobViews } from "@/lib/revalidate-job";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import {
  describeDiff,
  diffScope,
  regenDecision,
  statusAfterRegen,
  type ProposalStatus,
} from "@/lib/evaluation-resubmit";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { computeProposalTotal } from "@/lib/proposal-pricing";
import { scopesForZones, serviceLabelFor, type ZoneScopeInput } from "@/lib/zone-scope";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas-dimensions";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";
import type { Database } from "@/lib/supabase/database.types";
import { listScopeRecommendations } from "@/lib/data/scope-reviews";
import { reviewBlocker, reviewsFor } from "@/lib/scope-review";
import { zeroPriceBlocker } from "@/lib/proposal-guard";

function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * What came of asking for a new snapshot.
 *
 * A result rather than a throw or a bare null: this is called from a button
 * an evaluator presses on a driveway, and "nothing happened" with no reason
 * is what let a proposal sit on the wrong service for a week.
 */
export type GenerateOutcome =
  | { ok: true; token: string; changes: string[]; unchanged: boolean; note: string | null }
  | { ok: false; reason: "no_design" | "no_services" }
  | { ok: false; reason: "needs_confirmation"; confirm: string | null };

/**
 * Snapshots the current site map into a proposal awaiting an account
 * manager's approval — price and scope text are frozen at this moment (see
 * the migration's comment for why). Keeps the same shareable token across
 * regenerations, but resets any prior client response and drops it back to
 * "needs_approval", since a changed scope/price has to go through review
 * again before a client sees it.
 *
 * Runs when an evaluation is submitted, and again every time it is
 * resubmitted — a site map corrected an hour later has to be able to reach
 * the paperwork, which for a long time it could not.
 *
 * Reports why nothing happened rather than returning a bare null: no site
 * map, no zone with a service on it, or an accepted proposal that needs
 * somebody to agree before it is torn up. Pass `force` for that last one.
 */
export async function generateProposal(
  jobId: string,
  options: { force?: boolean } = {}
): Promise<GenerateOutcome> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const [design, catalog, organizationId] = await Promise.all([
    getCanvasDesignForJob(jobId),
    getCanvasCatalog(),
    getCurrentOrganizationId(),
  ]);
  if (!design) return { ok: false, reason: "no_design" };

  const zones = (design.zones as unknown as WorkZone[]).filter((z) => z.service);
  if (zones.length === 0) return { ok: false, reason: "no_services" };

  const { total } = computeProposalTotal(zones, catalog);

  const pricingBy = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));

  // Worked out for the whole plan at once rather than a zone at a time. The
  // crew does the same thing in every lawn area and the same thing in every
  // bed, so the paragraph belongs to the service and every area of it gets the
  // same one. A note typed on one area during the evaluation still wins for
  // that area, because it was written about that area.
  const scopeInputs: ZoneScopeInput[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    // A service this business invented has no built-in definition, and its
    // name lives on the pricing row. Without this the label fell through to
    // the raw `custom-<uuid>` and the client read a database id.
    const pricingRow = zone.service ? pricingBy.get(zone.service.typeId) : undefined;
    return {
      serviceId: zone.service?.typeId ?? null,
      def,
      pricing: pricingRow ? { name: pricingRow.name, scopeTemplate: pricingRow.scope_template } : undefined,
      values: zone.service?.values ?? {},
      // The evaluator's note is for us, not the client. It used to go here
      // and straight onto the proposal. It stays on the design, and what
      // the client reads is the recommendation the office approved.
      notes: undefined,
    };
  });
  const scopeTexts = scopesForZones(scopeInputs);
  const approved = new Map(
    (await listScopeRecommendations(jobId).catch(() => []))
      .filter((r) => r.status === "approved")
      .sort((a, b) => a.round - b.round)
      .map((r) => [r.zoneName, r.recommendedText])
  );

  const scopeSnapshot: ProposalZoneSnapshot[] = zones.map((zone, index) => {
    const def = scopeInputs[index].def;
    const pricingRow = zone.service ? pricingBy.get(zone.service.typeId) : undefined;
    const pricing = scopeInputs[index].pricing;
    // Priced one area at a time as well as all together, so that a client who
    // later asks to drop an area can be shown the price they were quoted
    // minus that area — rather than whatever today's rate card would say.
    const own = computeProposalTotal([zone], catalog);
    return {
      zoneName: zone.name,
      serviceLabel: serviceLabelFor(def, pricing),
      scopeText: approved.get(zone.name) ?? scopeTexts[index],
      photoPaths: zone.service?.photos ?? [],
      points: zone.points,
      color: zone.color,
      priceCents: Math.round(own.total * 100),
      // A service with no timing on it, or a material we have no cost for,
      // means this number is not something the costing fully produced.
      priceDerived: !own.hasMissingTiming && !own.hasUnknownMaterialCost,
      // Who a client will actually meet, frozen with the rest of the quote.
      performedBy: pricingRow?.performed_by === "partner" ? "partner" : "own",
      partnerName: pricingRow?.partner_name ?? null,
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
    .select("token, status, responded_at, approved_at, scope_snapshot")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existingError) throw existingError;

  // Regenerating clears a client's acceptance. That is right — they agreed to
  // work that is no longer what we are proposing — but it destroys a record
  // of somebody saying yes, so it never happens as a side effect.
  const decision = regenDecision(
    existing
      ? { status: existing.status as ProposalStatus, respondedAt: existing.responded_at }
      : null
  );
  if (!decision.allowed && !options.force) {
    return { ok: false, reason: "needs_confirmation", confirm: decision.confirm };
  }

  const previous = (existing?.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
  const token = existing?.token ?? generateToken();
  const nextStatus = statusAfterRegen(
    existing ? { status: existing.status as ProposalStatus, respondedAt: existing.responded_at } : null
  );

  const { error } = await supabase.from("job_proposals").upsert(
    {
      job_id: jobId,
      organization_id: organizationId,
      token,
      // The same token, and — once a client has it — the same live page.
      // Updating a proposal updates what their link shows; it does not take
      // the link away while somebody re-approves it.
      status: nextStatus,
      total_cost: total,
      scope_snapshot: scopeSnapshot,
      site_image_path: design.image_path,
      site_image_transform: siteImageTransform,
      generated_at: new Date().toISOString(),
      // A proposal that stays live stays approved — clearing this would leave
      // a sent proposal claiming nobody ever approved it.
      approved_at:
        nextStatus === "sent" ? existing?.approved_at ?? new Date().toISOString() : null,
      responded_at: null,
      client_response_note: null,
    },
    { onConflict: "job_id" }
  );
  if (error) throw error;

  revalidateJobViews(jobId);

  // What actually moved, so "the paperwork is stuck on lawn care" is
  // something the evaluator can check on the spot rather than days later.
  const diff = diffScope(previous, scopeSnapshot);
  return { ok: true, token, changes: describeDiff(diff), unchanged: diff.identical, note: decision.note };
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
  // The discount as it will stand after this save, so a save that keeps the
  // old discount is judged on the price it actually produces.
  let discountAfter = 0;
  if (input.discountId === undefined) {
    const { data: current } = await supabase.from("job_proposals").select("discount_amount").eq("job_id", jobId).maybeSingle();
    discountAfter = Number(current?.discount_amount ?? 0);
  }

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
    discountAfter = Number(patch.discount_amount);
  }

  // Never saved at nothing, draft or sent. A draft at $0 is a draft one
  // click from a $0 quote.
  const blocker = zeroPriceBlocker({ total_cost: input.totalCost, discount_amount: discountAfter });
  if (blocker) throw new Error(blocker);

  const { error } = await supabase.from("job_proposals").update(patch).eq("job_id", jobId);
  if (error) throw error;

  revalidateJobViews(jobId);
}

/** The account manager's sign-off — this is what actually makes the
 * proposal visible on its public link. */
export async function approveProposal(jobId: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  // Every zone the evaluator wrote on has to have an approved recommendation
  // standing for it. A proposal sent with a zone still under review sends
  // the template wording for that zone, which is not what anybody meant.
  const [design, catalog] = await Promise.all([getCanvasDesignForJob(jobId), getCanvasCatalog()]);
  if (design) {
    const pricingBy = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));
    const zones = (design.zones as unknown as WorkZone[])
      .filter((z) => z.service)
      .map((z, zoneIndex) => {
        const def = z.service ? serviceTypeById(z.service.typeId) : undefined;
        const pricing = z.service ? pricingBy.get(z.service.typeId) : undefined;
        return {
          zoneIndex,
          zoneName: z.name,
          note: (z.service?.notes ?? "").trim(),
          serviceLabel: serviceLabelFor(def, pricing ? { name: pricing.name, scopeTemplate: pricing.scope_template } : undefined),
        };
      });
    const blocker = reviewBlocker(reviewsFor(zones, await listScopeRecommendations(jobId).catch(() => [])));
    if (blocker) throw new Error(blocker);
  }

  const supabase = await createClient();

  // The last look at the number before a client sees it.
  const { data: priced } = await supabase.from("job_proposals").select("total_cost, discount_amount").eq("job_id", jobId).maybeSingle();
  if (!priced) throw new Error("There is no proposal on this job to send.");
  const priceBlocker = zeroPriceBlocker(priced);
  if (priceBlocker) throw new Error(priceBlocker);

  const { error } = await supabase
    .from("job_proposals")
    .update({ status: "sent", approved_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("status", "needs_approval");
  if (error) throw error;

  revalidateJobViews(jobId);
}
