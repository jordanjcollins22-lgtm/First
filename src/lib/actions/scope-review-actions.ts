"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { serviceLabelFor } from "@/lib/zone-scope";
import { listScopeRecommendations, recommendationFromRow } from "@/lib/data/scope-reviews";
import { nextRound, reviewsFor, zonesNeedingDraft, type ScopeRecommendation, type ZoneReview, type ZoneWithNote } from "@/lib/scope-review";
import { draftScopeLine } from "@/lib/scope-draft";
import type { ZoneBrief } from "@/lib/scope-suggestion";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { describeDbError } from "@/lib/setup-errors";
import { log } from "@/lib/log";
import type { WorkZone } from "@/components/canvas/types";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type ReviewResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const SELECT = "id, job_id, zone_index, zone_name, round, evaluator_note, recommended_text, status, decline_reason, decided_at, created_at";

/** The zones with a service on them, in proposal order, with the evaluator's note and a brief for the model. */
async function zonesWithNotes(jobId: string): Promise<{ zones: ZoneWithNote[]; briefs: Map<number, ZoneBrief> }> {
  const [design, catalog] = await Promise.all([getCanvasDesignForJob(jobId), getCanvasCatalog()]);
  if (!design) return { zones: [], briefs: new Map() };
  const withService = (design.zones as unknown as WorkZone[]).filter((z) => z.service);
  const pricingBy = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));
  const zones: ZoneWithNote[] = [];
  const briefs = new Map<number, ZoneBrief>();
  withService.forEach((zone, index) => {
    const note = (zone.service?.notes ?? "").trim();
    zones.push({ zoneIndex: index, zoneName: zone.name, note });
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    const pricing = zone.service ? pricingBy.get(zone.service.typeId) : undefined;
    const values = (zone.service?.values ?? {}) as Record<string, unknown>;
    const answers = Object.entries(values)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => ({ label: k.replace(/[_-]+/g, " "), value: Array.isArray(v) ? v.join(", ") : String(v) }));
    briefs.set(index, {
      zoneName: zone.name,
      serviceLabel: serviceLabelFor(def, pricing ? { name: pricing.name, scopeTemplate: pricing.scope_template } : undefined),
      notes: note,
      checklistAnswers: answers,
      materials: [],
    });
  });
  return { zones, briefs };
}

/**
 * The review for a job: every zone the evaluator wrote on, the current
 * recommendation for each, and the rounds before it. Writes a
 * recommendation for any zone that has none yet, or whose note has moved
 * on, so the screen always has something to approve or decline.
 */
export async function loadScopeReviews(jobId: string): Promise<ReviewResult<{ reviews: ZoneReview[]; drafting: boolean }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    const [{ zones, briefs }, recs] = await Promise.all([zonesWithNotes(jobId), listScopeRecommendations(jobId)]);
    let reviews = reviewsFor(zones, recs);
    const missing = zonesNeedingDraft(reviews).filter((r) => r.current == null || r.noteChanged);
    if (missing.length > 0) {
      const organizationId = await getCurrentOrganizationId();
      const supabase = await createClient();
      const written: ScopeRecommendation[] = [];
      for (const zone of missing) {
        const brief = briefs.get(zone.zoneIndex);
        if (!brief) continue;
        const text = await draftScopeLine(brief).catch((err) => {
          log.warn("scope.review.draft_failed", { job: jobId, zone: zone.zoneName, error: String(err) });
          return null;
        });
        if (!text) continue;
        const { data } = await supabase
          .from("scope_recommendations")
          .insert({
            organization_id: organizationId,
            job_id: jobId,
            zone_index: zone.zoneIndex,
            zone_name: zone.zoneName,
            round: nextRound(recs, zone.zoneIndex),
            evaluator_note: zone.note,
            recommended_text: text,
          })
          .select(SELECT)
          .single();
        if (data) written.push(recommendationFromRow(data));
      }
      if (written.length > 0) reviews = reviewsFor(zones, [...recs, ...written]);
    }
    return { ok: true, value: { reviews, drafting: false } };
  } catch (err) {
    log.error("scope.review.load", err);
    return { ok: false, message: "Couldn't load the scope review." };
  }
}

/** Approve the recommendation: it becomes the proposal's wording for that zone. */
export async function approveScopeRecommendation(id: string): Promise<ReviewResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    const supabase = await createClient();
    const { data: rec, error } = await supabase.from("scope_recommendations").select(SELECT).eq("id", id).maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };
    if (!rec) return { ok: false, message: "That recommendation is not on file." };
    if (rec.status !== "pending") return { ok: false, message: "That round has already been decided." };

    const { error: updateError } = await supabase
      .from("scope_recommendations")
      .update({ status: "approved", decided_by: profile.id, decided_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) return { ok: false, message: describeDbError(updateError) };

    // Onto the proposal, if there is one to carry it. Matched by name first
    // and position second, because a zone renamed since is still that zone.
    const { data: proposal } = await supabase.from("job_proposals").select("id, scope_snapshot, status").eq("job_id", rec.job_id).maybeSingle();
    if (proposal && proposal.status !== "accepted") {
      const snapshot = ((proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[]).map((z) => ({ ...z }));
      const at = snapshot.findIndex((z) => z.zoneName === rec.zone_name);
      const target = at >= 0 ? at : rec.zone_index;
      if (snapshot[target]) {
        snapshot[target].scopeText = rec.recommended_text;
        await supabase.from("job_proposals").update({ scope_snapshot: snapshot as never }).eq("id", proposal.id);
      }
    }
    revalidateJobViews(rec.job_id);
    return { ok: true, value: undefined };
  } catch (err) {
    log.error("scope.review.approve", err);
    return { ok: false, message: "Couldn't approve that." };
  }
}

/** Decline it, say why, and get the next round written from the note and the reason. */
export async function declineScopeRecommendation(id: string, reason: string): Promise<ReviewResult<{ next: ScopeRecommendation | null }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    const why = reason.trim();
    if (why.length < 3) return { ok: false, message: "Say why, so the next one can fix it." };
    const supabase = await createClient();
    const { data: rec, error } = await supabase.from("scope_recommendations").select(SELECT).eq("id", id).maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };
    if (!rec) return { ok: false, message: "That recommendation is not on file." };
    if (rec.status !== "pending") return { ok: false, message: "That round has already been decided." };

    const { error: updateError } = await supabase
      .from("scope_recommendations")
      .update({ status: "declined", decline_reason: why, decided_by: profile.id, decided_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) return { ok: false, message: describeDbError(updateError) };

    const [{ briefs }, recs, organizationId] = await Promise.all([zonesWithNotes(rec.job_id), listScopeRecommendations(rec.job_id), getCurrentOrganizationId()]);
    const brief = briefs.get(rec.zone_index);
    let next: ScopeRecommendation | null = null;
    if (brief) {
      const text = await draftScopeLine({ ...brief, notes: rec.evaluator_note }, { previous: rec.recommended_text, reason: why }).catch((err) => {
        log.warn("scope.review.revise_failed", { job: rec.job_id, zone: rec.zone_name, error: String(err) });
        return null;
      });
      if (text) {
        const { data } = await supabase
          .from("scope_recommendations")
          .insert({
            organization_id: organizationId,
            job_id: rec.job_id,
            zone_index: rec.zone_index,
            zone_name: rec.zone_name,
            round: nextRound(recs, rec.zone_index),
            evaluator_note: rec.evaluator_note,
            recommended_text: text,
          })
          .select(SELECT)
          .single();
        if (data) next = recommendationFromRow(data);
      }
    }
    revalidateJobViews(rec.job_id);
    return { ok: true, value: { next } };
  } catch (err) {
    log.error("scope.review.decline", err);
    return { ok: false, message: "Couldn't record that." };
  }
}
