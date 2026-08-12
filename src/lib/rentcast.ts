import { env, isRentcastConfigured } from "@/lib/env";

export interface PropertyDetails {
  sqft: number | null;
  acreage: number | null;
}

const SQFT_PER_ACRE = 43560;

/**
 * Best-effort lookup — a new property should still get created even if
 * RentCast is unconfigured, the address can't be matched, or the API
 * errors, so this never throws.
 */
export async function lookupPropertyDetails(address: string): Promise<PropertyDetails | null> {
  if (!isRentcastConfigured) return null;

  try {
    const res = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`, {
      headers: { "X-Api-Key": env.rentcastApiKey, Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const record = Array.isArray(data) ? data[0] : data;
    if (!record || typeof record !== "object") return null;

    const r = record as Record<string, unknown>;
    const sqft = typeof r.squareFootage === "number" ? r.squareFootage : null;
    const lotSizeSqft = typeof r.lotSize === "number" ? r.lotSize : null;
    const acreage = lotSizeSqft != null ? Math.round((lotSizeSqft / SQFT_PER_ACRE) * 100) / 100 : null;

    if (sqft == null && acreage == null) return null;
    return { sqft, acreage };
  } catch {
    return null;
  }
}
