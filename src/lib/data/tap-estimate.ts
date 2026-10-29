import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getIntakeByToken, type PublicIntake } from "@/lib/data/evaluation-intake";
import { lotForProperty } from "@/lib/data/lot-map";
import type { InstantPrice } from "@/lib/instant-price";
import type { LngLat, LotData } from "@/lib/lot-map";
import { readTapSpots, type TapSpot } from "@/lib/tap-estimate";

export interface ClientEstimate {
  id: string;
  spots: TapSpot[];
  price: InstantPrice;
  totalCents: number;
  depositCents: number;
  acceptedAt: string | null;
  depositPaidAt: string | null;
  createdAt: string;
}

export interface TapPreEval {
  intake: PublicIntake;
  /** Where the house is, to centre the map on. Null when the property has no coordinates. */
  home: LngLat | null;
  lot: LotData | null;
  estimate: ClientEstimate | null;
  /** Signed links for the spots' photos, by path. */
  photoUrls: Record<string, string>;
}

/**
 * Everything the map pre-evaluation and its estimate show, for a client
 * with no account. The intake token is the whole of the authorisation, as
 * it is for the long form.
 */
export async function getTapPreEval(token: string): Promise<TapPreEval | null> {
  const intake = await getIntakeByToken(token);
  if (!intake) return null;
  const admin = createAdminClient();
  const [{ data: property }, { data: estimate }, lot] = await Promise.all([
    intake.propertyId
      ? admin.from("properties").select("lat, lng").eq("id", intake.propertyId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("job_estimates")
      .select("id, spots, price, total_cents, deposit_cents, accepted_at, deposit_paid_at, created_at")
      .eq("job_id", intake.jobId)
      .maybeSingle(),
    intake.propertyId ? lotForProperty(intake.propertyId) : Promise.resolve(null),
  ]);

  const home: LngLat | null = property?.lat != null && property?.lng != null ? [property.lng, property.lat] : null;
  return {
    intake,
    home,
    lot,
    estimate: estimate
      ? {
          id: estimate.id,
          spots: readTapSpots(estimate.spots),
          price: estimate.price as unknown as InstantPrice,
          totalCents: estimate.total_cents,
          depositCents: estimate.deposit_cents,
          acceptedAt: estimate.accepted_at,
          depositPaidAt: estimate.deposit_paid_at,
          createdAt: estimate.created_at,
        }
      : null,
    photoUrls: Object.fromEntries(intake.photoUrls.map((p) => [p.path, p.url])),
  };
}

/** The estimate on a job, for the office. Null when the client hasn't done the map. */
export async function getEstimateForJob(jobId: string): Promise<ClientEstimate | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_estimates")
    .select("id, spots, price, total_cents, deposit_cents, accepted_at, deposit_paid_at, created_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    spots: readTapSpots(data.spots),
    price: data.price as unknown as InstantPrice,
    totalCents: data.total_cents,
    depositCents: data.deposit_cents,
    acceptedAt: data.accepted_at,
    depositPaidAt: data.deposit_paid_at,
    createdAt: data.created_at,
  };
}

/** Where each page of the map pre-evaluation lives. */
export const tapMapPath = (token: string) => `/prep/${token}/map`;
export const estimatePath = (token: string) => `/prep/${token}/estimate`;
