import { env, isRentcastConfigured } from "@/lib/env";
import { fetchJson } from "@/lib/resilient-fetch";

export interface PropertyDetails {
  sqft: number | null;
  acreage: number | null;
}

const SQFT_PER_ACRE = 43560;

/**
 * How long a lot-size lookup may hold up the thing it is decorating.
 *
 * This runs while somebody is adding a property or booking a job, and the
 * square footage is a nicety on a record that has to be saved either way. Two
 * seconds and a single retry is the most that is worth making them wait for a
 * field they can type in themselves.
 */
const DETAIL_TIMEOUT_MS = 2_000;

/**
 * Best-effort lookup — a new property should still get created even if
 * RentCast is unconfigured, the address can't be matched, or the API
 * errors, so this never throws.
 *
 * When RentCast is slow or down: the caller gets null after at most a couple
 * of seconds and the property is written without a size on it. Nobody is
 * blocked, and the field can be filled in by hand or by the next lookup.
 */
export async function lookupPropertyDetails(address: string): Promise<PropertyDetails | null> {
  if (!isRentcastConfigured) return null;

  const outcome = await fetchJson<unknown>(
    `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`,
    {
      timeoutMs: DETAIL_TIMEOUT_MS,
      attempts: 2,
      init: { headers: { "X-Api-Key": env.rentcastApiKey, Accept: "application/json" } },
    }
  );
  if (!outcome.ok) return null;

  const record = Array.isArray(outcome.value) ? outcome.value[0] : outcome.value;
  if (!record || typeof record !== "object") return null;

  const r = record as Record<string, unknown>;
  const sqft = typeof r.squareFootage === "number" ? r.squareFootage : null;
  const lotSizeSqft = typeof r.lotSize === "number" ? r.lotSize : null;
  const acreage = lotSizeSqft != null ? Math.round((lotSizeSqft / SQFT_PER_ACRE) * 100) / 100 : null;

  if (sqft == null && acreage == null) return null;
  return { sqft, acreage };
}

export interface NearbyProperty {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  sqft: number | null;
  acreage: number | null;
  yearBuilt: number | null;
  ownerName: string | null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Every property within a radius of a point.
 *
 * This is what makes the prospect list grow on its own: finish a job, and the
 * houses around it become candidates. Neighbours of a happy customer are the
 * strongest signal in home services — they have the same lot sizes, the same
 * street, and they can see the work.
 *
 * Returns [] rather than throwing on any failure. It runs from a nightly cron
 * where a bad response should cost nothing but a skipped night — including the
 * response that never arrives at all, which without a deadline of our own
 * costs the whole night's run rather than one seed.
 */
export async function searchPropertiesNear(
  lat: number,
  lng: number,
  radiusMiles: number,
  limit: number
): Promise<NearbyProperty[]> {
  if (!isRentcastConfigured) return [];

  const url = new URL("https://api.rentcast.io/v1/properties");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("radius", String(radiusMiles));
  url.searchParams.set("propertyType", "Single Family");
  url.searchParams.set("limit", String(limit));

  // Nobody is waiting on this one, so it gets a longer deadline and one more
  // go than the interactive lookup — but still a deadline, because a cron that
  // never returns is a cron that never runs again.
  const outcome = await fetchJson<unknown>(url, {
    timeoutMs: 10_000,
    attempts: 3,
    init: { headers: { "X-Api-Key": env.rentcastApiKey, Accept: "application/json" } },
  });
  if (!outcome.ok) return [];

  const records = Array.isArray(outcome.value) ? outcome.value : [outcome.value];

  return records
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => {
      const lotSizeSqft = toNumber(r.lotSize);
      // Owner details only come back on plans that include them; absence is
      // normal, not an error.
      const owner = r.owner as { names?: unknown } | undefined;
      const ownerName =
        owner && Array.isArray(owner.names) && typeof owner.names[0] === "string" ? owner.names[0] : null;

      return {
        address: typeof r.formattedAddress === "string" ? r.formattedAddress : String(r.addressLine1 ?? ""),
        city: typeof r.city === "string" ? r.city : null,
        state: typeof r.state === "string" ? r.state : null,
        zip: typeof r.zipCode === "string" ? r.zipCode : null,
        lat: toNumber(r.latitude),
        lng: toNumber(r.longitude),
        sqft: toNumber(r.squareFootage),
        acreage: lotSizeSqft != null ? Math.round((lotSizeSqft / SQFT_PER_ACRE) * 100) / 100 : null,
        yearBuilt: toNumber(r.yearBuilt),
        ownerName,
      };
    })
    .filter((p) => p.address.trim() !== "");
}
