import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getIntakeByToken, type PublicIntake } from "@/lib/data/evaluation-intake";
import { lotForProperty } from "@/lib/data/lot-map";
import { readTiers, type EvaluationTier, type TierId } from "@/lib/evaluation-tiers";
import type { InstantPrice } from "@/lib/instant-price";
import type { LngLat, LotData } from "@/lib/lot-map";
import { readTapSpots, type TapSpot } from "@/lib/tap-estimate";
import { readSizing, type EstimateSizing } from "@/lib/spot-size-words";

export interface ClientEstimate {
  id: string;
  spots: TapSpot[];
  price: InstantPrice;
  /** How each spot was sized, by spot index. Empty on estimates from before sizes were kept. */
  sizing: EstimateSizing[];
  totalCents: number;
  depositCents: number;
  /** Chose how to pay and was sent to pay. */
  acceptedAt: string | null;
  /** Put a deposit down, or booked a paid evaluation instead. Null until they choose. */
  choice: "deposit" | "evaluation" | null;
  /** The evaluation visit they get: the one they paid for, or the one that comes with a deposit. */
  evaluationTier: TierId | null;
  /** What the checkout was for, before the card fee. */
  chargedCents: number | null;
  /** The payment landed. */
  paidAt: string | null;
  /** After a deposit: the day they'd like the work to start, YYYY-MM-DD, for the team to confirm. */
  startDay: string | null;
  createdAt: string;
}

export interface TapPreEval {
  intake: PublicIntake;
  organizationId: string | null;
  /** Where the house is, to centre the map on. Null when the property has no coordinates. */
  home: LngLat | null;
  lot: LotData | null;
  estimate: ClientEstimate | null;
  /** The paid evaluations this business offers. */
  tiers: EvaluationTier[];
  /** Signed links for the spots' photos, by path. */
  photoUrls: Record<string, string>;
}

const ESTIMATE_COLUMNS =
  "id, spots, price, sizing, total_cents, deposit_cents, accepted_at, choice, evaluation_tier, charged_cents, paid_at, start_day, created_at" as const;

type EstimateRow = {
  id: string;
  spots: unknown;
  price: unknown;
  sizing: unknown;
  total_cents: number;
  deposit_cents: number;
  accepted_at: string | null;
  choice: "deposit" | "evaluation" | null;
  evaluation_tier: TierId | null;
  charged_cents: number | null;
  paid_at: string | null;
  start_day: string | null;
  created_at: string;
};

function toEstimate(row: EstimateRow): ClientEstimate {
  return {
    id: row.id,
    spots: readTapSpots(row.spots),
    price: row.price as InstantPrice,
    sizing: readSizing(row.sizing),
    totalCents: row.total_cents,
    depositCents: row.deposit_cents,
    acceptedAt: row.accepted_at,
    choice: row.choice,
    evaluationTier: row.evaluation_tier,
    chargedCents: row.charged_cents,
    paidAt: row.paid_at,
    startDay: row.start_day,
    createdAt: row.created_at,
  };
}

/** The tiers a business offers, as the service role reads them. */
export async function tiersForOrganization(organizationId: string): Promise<EvaluationTier[]> {
  const { data } = await createAdminClient().from("organizations").select("evaluation_tiers").eq("id", organizationId).maybeSingle();
  return readTiers(data?.evaluation_tiers);
}

/**
 * Everything the map pre-evaluation, its estimate and the visit booking
 * show, for a client with no account. The intake token is the whole of the
 * authorisation, as it is for the long form.
 */
export async function getTapPreEval(token: string): Promise<TapPreEval | null> {
  const intake = await getIntakeByToken(token);
  if (!intake) return null;
  const admin = createAdminClient();
  const [{ data: property }, { data: estimate }, { data: intakeRow }, lot] = await Promise.all([
    intake.propertyId
      ? admin.from("properties").select("lat, lng").eq("id", intake.propertyId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("job_estimates").select(ESTIMATE_COLUMNS).eq("job_id", intake.jobId).maybeSingle(),
    admin.from("evaluation_intakes").select("organization_id").eq("token", token).maybeSingle(),
    intake.propertyId ? lotForProperty(intake.propertyId) : Promise.resolve(null),
  ]);

  const home: LngLat | null = property?.lat != null && property?.lng != null ? [property.lng, property.lat] : null;
  return {
    intake,
    organizationId: intakeRow?.organization_id ?? null,
    home,
    lot,
    estimate: estimate ? toEstimate(estimate as unknown as EstimateRow) : null,
    tiers: intakeRow ? await tiersForOrganization(intakeRow.organization_id) : readTiers(null),
    photoUrls: Object.fromEntries(intake.photoUrls.map((p) => [p.path, p.url])),
  };
}

/** The estimate on a job, for the office. Null when the client hasn't done the map. */
export async function getEstimateForJob(jobId: string): Promise<ClientEstimate | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_estimates").select(ESTIMATE_COLUMNS).eq("job_id", jobId).maybeSingle();
  return data ? toEstimate(data as unknown as EstimateRow) : null;
}

/** Where each page of the client's path lives, after their details. */
export const tapMapPath = (token: string) => `/prep/${token}/map`;
export const estimatePath = (token: string) => `/prep/${token}/estimate`;
export const schedulePath = (token: string) => `/prep/${token}/schedule`;
