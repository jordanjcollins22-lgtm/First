"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { normalizeAddress } from "@/lib/dedupe";
import { lookupPropertyDetails } from "@/lib/rentcast";
import { isRentcastConfigured } from "@/lib/env";
import { applyTargetFilter, dedupeDrafts, importCsv, type TargetFilter } from "@/lib/prospect-import";
import { assessLead, calibrateFromHistory, estimateTicket, TARGET_TICKET } from "@/lib/leads";
import { reconcileProspects } from "@/lib/data/prospect-reconcile";

export type ProspectResult =
  | { ok: true; imported: number; updated: number; skippedExisting: number; skippedRows: number; unmapped: string[] }
  | { ok: false; message: string };

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) return null;
  return profile;
}

/**
 * Imports a list of properties as prospects.
 *
 * Anything already a client is skipped rather than imported — the point of a
 * prospect list is people the business hasn't worked with, and importing an
 * existing client would put them on a cold-call list.
 */
export async function importProspects(
  csvText: string,
  batchName: string,
  filter: TargetFilter
): Promise<ProspectResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can import prospects." };
    if (!csvText.trim()) return { ok: false, message: "Paste or upload a file first." };

    const report = importCsv(csvText);
    if (report.drafts.length === 0) {
      const why = report.skipped[0]?.reason ?? "Nothing usable in that file.";
      return { ok: false, message: why };
    }

    const targeted = applyTargetFilter(report.drafts, filter);
    const { unique } = dedupeDrafts(targeted);
    if (unique.length === 0) {
      return { ok: false, message: "Every row was filtered out. Loosen the filters and try again." };
    }

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    // Anyone already on the books isn't a prospect.
    const { data: properties } = await supabase.from("properties").select("address");
    const clientKeys = new Set((properties ?? []).map((p) => normalizeAddress(p.address)));

    const fresh = unique.filter((d) => !clientKeys.has(d.addressKey));
    const skippedExisting = unique.length - fresh.length;

    if (fresh.length === 0) {
      return {
        ok: true,
        imported: 0,
        updated: 0,
        skippedExisting,
        skippedRows: report.skipped.length,
        unmapped: report.unmappedHeaders,
      };
    }

    // Score each one now so the list is useful the moment it lands.
    const calibration = calibrateFromHistory([]);
    const rows = fresh.map((d) => {
      const estimate = estimateTicket(d.acreage, calibration);
      const assessment = assessLead(
        {
          jobStatus: "estimating",
          proposalStatus: null,
          proposalTotal: null,
          evaluationStatus: null,
          evaluationDate: null,
          lastActivity: null,
          acreage: d.acreage,
        },
        calibration
      );
      return {
        organization_id: organizationId,
        source: "import",
        source_batch: batchName.trim() || null,
        owner_name: d.ownerName,
        address: d.address,
        address_key: d.addressKey,
        city: d.city,
        state: d.state,
        zip: d.zip,
        acreage: d.acreage,
        sqft: d.sqft,
        year_built: d.yearBuilt,
        assessed_value: d.assessedValue,
        phone: d.phone,
        email: d.email,
        estimated_ticket: estimate,
        score: assessment.score,
      };
    });

    // Re-importing the same list updates rather than duplicating.
    const { data: inserted, error } = await supabase
      .from("lead_prospects")
      .upsert(rows, { onConflict: "organization_id,address_key" })
      .select("id");
    if (error) return { ok: false, message: error.message };

    // Catches anyone the address check missed — same person, different address
    // on file, or a name/phone/email already in the book.
    await reconcileProspects(supabase).catch(() => null);

    revalidatePath("/leads");
    return {
      ok: true,
      imported: inserted?.length ?? 0,
      updated: 0,
      skippedExisting,
      skippedRows: report.skipped.length,
      unmapped: report.unmappedHeaders,
    };
  } catch (err) {
    console.error("importProspects failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Import failed." };
  }
}

export type SimpleResult = { ok: true; message?: string } | { ok: false; message: string };

export async function setProspectStatus(
  id: string,
  status: "new" | "queued" | "contacted" | "converted" | "rejected"
): Promise<SimpleResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can manage prospects." };
    const supabase = await createClient();
    const { error } = await supabase.from("lead_prospects").update({ status }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    console.error("setProspectStatus failed:", err);
    return { ok: false, message: "Couldn't update that." };
  }
}

/**
 * Marks somebody as never to be contacted again.
 *
 * Kept as its own flag rather than a status so it survives every other edit —
 * a do-not-contact request is the one thing in this list that must not be
 * undone by somebody changing a dropdown.
 */
export async function setDoNotContact(id: string, reason: string | null): Promise<SimpleResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can manage prospects." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_prospects")
      .update({ do_not_contact: true, do_not_contact_reason: reason, status: "rejected" })
      .eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    console.error("setDoNotContact failed:", err);
    return { ok: false, message: "Couldn't update that." };
  }
}

/** Removes a whole import in one go, for when a list turns out to be wrong. */
export async function deleteProspectBatch(batch: string): Promise<SimpleResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can manage prospects." };
    const supabase = await createClient();
    // Do-not-contact rows stay, so a re-import can't resurrect somebody who
    // asked to be left alone.
    const { error } = await supabase
      .from("lead_prospects")
      .delete()
      .eq("source_batch", batch)
      .eq("do_not_contact", false);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    console.error("deleteProspectBatch failed:", err);
    return { ok: false, message: "Couldn't remove that batch." };
  }
}

/**
 * Fills in lot size and value from RentCast for prospects that arrived without
 * it — a list with no acreage can't be scored, and lot size is what drives the
 * ticket estimate.
 *
 * Capped per run because it's a paid, rate-limited API.
 */
export async function enrichProspects(limit = 20): Promise<SimpleResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can manage prospects." };
    if (!isRentcastConfigured) {
      return { ok: false, message: "RentCast isn't configured — add RENTCAST_API_KEY to enrich addresses." };
    }

    const supabase = await createClient();
    const { data: pending } = await supabase
      .from("lead_prospects")
      .select("id, address, city, state, zip")
      .is("acreage", null)
      .eq("do_not_contact", false)
      .limit(limit);

    if (!pending || pending.length === 0) return { ok: true, message: "Nothing needed enriching." };

    const calibration = calibrateFromHistory([]);
    let enriched = 0;

    for (const prospect of pending) {
      const full = [prospect.address, prospect.city, prospect.state, prospect.zip].filter(Boolean).join(", ");
      const details = await lookupPropertyDetails(full).catch(() => null);
      if (!details) continue;

      const acreage = details.acreage ?? null;
      const estimate = estimateTicket(acreage, calibration);

      await supabase
        .from("lead_prospects")
        .update({
          acreage,
          sqft: details.sqft ?? null,
          estimated_ticket: estimate,
          score: estimate != null && estimate >= TARGET_TICKET ? 45 : 20,
        })
        .eq("id", prospect.id);
      enriched++;
    }

    revalidatePath("/leads");
    return { ok: true, message: `Filled in ${enriched} of ${pending.length}.` };
  } catch (err) {
    console.error("enrichProspects failed:", err);
    return { ok: false, message: "Enrichment failed." };
  }
}

/**
 * Runs the cross-check against the client book on demand.
 *
 * The same sweep happens automatically after an import, whenever a property or
 * online booking creates a client, and once nightly on the cron. This is for
 * when somebody wants to see it happen rather than trust that it did.
 */
export async function reconcileProspectsNow(): Promise<SimpleResult> {
  try {
    if (!(await requireAdmin())) return { ok: false, message: "Only admins can manage prospects." };
    const supabase = await createClient();
    const report = await reconcileProspects(supabase);
    revalidatePath("/leads");
    return {
      ok: true,
      message:
        report.matched > 0
          ? `Checked ${report.checked}. ${report.matched} turned out to already be clients and came off the list.`
          : `Checked ${report.checked}. None of them are clients yet.`,
    };
  } catch (err) {
    console.error("reconcileProspectsNow failed:", err);
    return { ok: false, message: "Couldn't run the check." };
  }
}
