import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import {
  MARKER_LIMIT,
  contactState,
  summariseCoverage,
  type ContactState,
  type CoverageSummary,
} from "@/lib/coverage-map";

async function safe<T>(query: PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>): Promise<{
  rows: T[];
  missing: boolean;
}> {
  try {
    const { data, error } = await query;
    return { rows: data ?? [], missing: isMissingTable(error) };
  } catch {
    return { rows: [], missing: false };
  }
}

export interface CoverageMarker {
  id: string;
  lat: number;
  lng: number;
  state: ContactState;
}

export interface CoverageBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The freshest outcome per prospect.
 *
 * One pass over the touches rather than a query per prospect: the point of
 * this map is a county's worth of properties, and a lookup each would be
 * ninety thousand round trips.
 */
function latestOutcomes(
  touches: { prospect_id: string | null; outcome: string; at: string; referral_note: string | null }[]
): { last: Map<string, string>; everReferred: Set<string> } {
  const last = new Map<string, string>();
  const seenAt = new Map<string, string>();
  const everReferred = new Set<string>();

  for (const touch of touches) {
    if (!touch.prospect_id) continue;
    if (touch.outcome === "referral_received") everReferred.add(touch.prospect_id);

    const previous = seenAt.get(touch.prospect_id);
    if (!previous || touch.at > previous) {
      seenAt.set(touch.prospect_id, touch.at);
      last.set(touch.prospect_id, touch.outcome);
    }
  }

  return { last, everReferred };
}

export interface CoverageData {
  summary: CoverageSummary;
  setupNeeded: boolean;
}

/**
 * County-wide totals, for the bar at the top.
 *
 * Reads every prospect's state — no coordinates, no addresses — because the
 * question "how much of the county have we touched" is about all of it, not
 * about whatever happens to be on screen.
 */
export async function getCoverageSummary(): Promise<CoverageData> {
  const supabase = await createClient();

  const [prospects, touches] = await Promise.all([
    safe(supabase.from("lead_prospects").select("id, status, do_not_contact")),
    safe(supabase.from("outreach_touches").select("prospect_id, outcome, at, referral_note")),
  ]);

  if (prospects.missing) {
    return { summary: summariseCoverage([]), setupNeeded: true };
  }

  const { last, everReferred } = latestOutcomes(
    touches.rows as unknown as {
      prospect_id: string | null;
      outcome: string;
      at: string;
      referral_note: string | null;
    }[]
  );

  const states = (prospects.rows as unknown as { id: string; status: string; do_not_contact: boolean }[]).map(
    (p) =>
      contactState({
        status: p.status,
        doNotContact: p.do_not_contact,
        lastOutcome: last.get(p.id) ?? null,
        everReferred: everReferred.has(p.id),
      })
  );

  return { summary: summariseCoverage(states), setupNeeded: false };
}

/**
 * The properties inside the current view.
 *
 * Bounded and capped rather than sending the county: ninety thousand markers
 * is several megabytes down a phone's connection to draw a grey smear nobody
 * can read. The map asks again as it moves, which is both faster and the only
 * version that works on the road.
 */
export async function getCoverageMarkers(bounds: CoverageBounds): Promise<CoverageMarker[]> {
  const supabase = await createClient();

  const [prospects, touches] = await Promise.all([
    safe(
      supabase
        .from("lead_prospects")
        .select("id, lat, lng, status, do_not_contact")
        .not("lat", "is", null)
        .not("lng", "is", null)
        .gte("lat", bounds.south)
        .lte("lat", bounds.north)
        .gte("lng", bounds.west)
        .lte("lng", bounds.east)
        .limit(MARKER_LIMIT)
    ),
    safe(supabase.from("outreach_touches").select("prospect_id, outcome, at, referral_note")),
  ]);

  const { last, everReferred } = latestOutcomes(
    touches.rows as unknown as {
      prospect_id: string | null;
      outcome: string;
      at: string;
      referral_note: string | null;
    }[]
  );

  return (
    prospects.rows as unknown as {
      id: string;
      lat: number;
      lng: number;
      status: string;
      do_not_contact: boolean;
    }[]
  ).map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    state: contactState({
      status: p.status,
      doNotContact: p.do_not_contact,
      lastOutcome: last.get(p.id) ?? null,
      everReferred: everReferred.has(p.id),
    }),
  }));
}
