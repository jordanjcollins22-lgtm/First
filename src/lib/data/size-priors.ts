import type { createAdminClient } from "@/lib/supabase/admin";
import type { WorkZone } from "@/components/canvas/types";
import { measuredZoneFrom, sizePriorsFrom, type MeasuredZone } from "@/lib/size-priors";
import type { SizePriors } from "@/lib/spot-sizing";

/**
 * The business's own measured zones, read for the instant estimate.
 *
 * Read with the service role because the client pricing their yard has no
 * account; scoped by hand to the one organisation, the same way the
 * canvas_designs policy scopes it (jobs -> properties -> customers, whose
 * organization_id is the only place a job's organisation is recorded).
 *
 * The most recent DESIGN_LIMIT designs only: recent jobs reflect how the
 * business measures now, and a few hundred is plenty for a median.
 * Cancelled jobs are left out -- a site map for a job that fell through may
 * never have been finished. Approved, under-way and completed jobs are marked
 * sold so sizePriorsFrom can prefer them.
 *
 * Never throws. A price with no history falls through to the next size
 * source, so a failed read costs accuracy, not the estimate.
 */

type Admin = ReturnType<typeof createAdminClient>;

const DESIGN_LIMIT = 300;
const SOLD = new Set(["approved", "in_progress", "completed"]);

interface DesignRow {
  zones: WorkZone[] | null;
  job: { status: string | null } | null;
}

async function read(admin: Admin, organizationId: string): Promise<SizePriors> {
  try {
    const { data, error } = await admin
      .from("canvas_designs")
      .select("zones, job:jobs!inner(status, property:properties!inner(customer:customers!inner(organization_id)))")
      .eq("job.property.customer.organization_id", organizationId)
      .neq("job.status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(DESIGN_LIMIT);
    if (error || !data) return {};

    const zones: MeasuredZone[] = [];
    for (const row of data as unknown as DesignRow[]) {
      const sold = SOLD.has(row.job?.status ?? "");
      for (const zone of Array.isArray(row.zones) ? row.zones : []) {
        const measured = zone ? measuredZoneFrom(zone, sold) : null;
        if (measured) zones.push(measured);
      }
    }
    return sizePriorsFrom(zones);
  } catch {
    return {};
  }
}

/**
 * Remembered per client, so pricing several spots in one request (or pricing
 * and then rendering) reads the table once. Keyed on the client object rather
 * than React's cache(), which matches arguments by identity anyway and only
 * works inside a render; a server action makes one admin client and passes it
 * round, and that is what this catches. A WeakMap, so the entry goes when the
 * client does.
 */
const remembered = new WeakMap<Admin, Map<string, Promise<SizePriors>>>();

/** Size priors for one organisation. Never throws; {} when there is nothing to go on. */
export function sizePriorsFor(admin: Admin, organizationId: string): Promise<SizePriors> {
  let byOrg = remembered.get(admin);
  if (!byOrg) {
    byOrg = new Map();
    remembered.set(admin, byOrg);
  }
  const hit = byOrg.get(organizationId);
  if (hit) return hit;
  const pending = read(admin, organizationId);
  byOrg.set(organizationId, pending);
  return pending;
}
