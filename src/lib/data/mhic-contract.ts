import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  depositCapCents,
  isHomeImprovementScope,
  mhicContractClauses,
  servicesOfSnapshot,
  type ContractClause,
} from "@/lib/sales/mhic";

/**
 * The Maryland home-improvement block for a client's proposal, or null when
 * the work is exempt (mowing, cleanups, snow). Read with the service role
 * because the proposal page has no session. Never throws: a proposal that
 * would not open because this failed is worse than one without the block,
 * and the payment side enforces the deposit cap on its own.
 */

export interface MhicBlock {
  clauses: ContractClause[];
  depositCapCents: number;
  /** The licence number is not on file yet: shown to the office, so it gets entered. */
  licenseMissing: boolean;
}

export async function mhicBlockForProposal(input: {
  organizationId: string;
  jobId: string;
  snapshot: { serviceLabel?: string | null; lines?: { key: string }[] | null }[];
  contractCents: number;
}): Promise<MhicBlock | null> {
  try {
    if (!isHomeImprovementScope(servicesOfSnapshot(input.snapshot))) return null;
    const admin = createAdminClient();
    const [{ data: org }, { data: settings }, { data: job }] = await Promise.all([
      admin.from("organizations").select("name, business_address").eq("id", input.organizationId).maybeSingle(),
      (admin as unknown as SupabaseClient).from("sales_autopilot_settings").select("mhic_license").eq("organization_id", input.organizationId).maybeSingle(),
      admin.from("jobs").select("evaluation_date, project_start_date, project_end_date, assigned_to").eq("id", input.jobId).maybeSingle(),
    ]);
    let salesperson: { name: string; license: string | null } | null = null;
    if (job?.assigned_to) {
      const { data: person } = await admin.from("profiles").select("full_name, first_name").eq("id", job.assigned_to).maybeSingle();
      const name = (person?.full_name ?? person?.first_name ?? "").trim();
      if (name) salesperson = { name, license: null };
    }
    const day = (iso: string | null | undefined) =>
      iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : null;
    const license = ((settings as { mhic_license?: string | null } | null)?.mhic_license ?? "").trim() || null;
    return {
      clauses: mhicContractClauses({
        businessName: org?.name ?? "",
        businessAddress: org?.business_address ?? null,
        mhicLicense: license,
        salesperson,
        contractCents: input.contractCents,
        startText: day(job?.project_start_date),
        completionText: day(job?.project_end_date),
      }),
      depositCapCents: depositCapCents(input.contractCents),
      licenseMissing: !license,
    };
  } catch (err) {
    console.error("[mhic] block not built:", input.jobId, err);
    return null;
  }
}

/**
 * Whether a proposal is home-improvement work, read from its snapshot: for
 * the payment side, which caps what is taken at signing.
 */
export function isHomeImprovementProposal(snapshot: unknown): boolean {
  return isHomeImprovementScope(servicesOfSnapshot(Array.isArray(snapshot) ? (snapshot as { serviceLabel?: string | null; lines?: { key: string }[] | null }[]) : []));
}
