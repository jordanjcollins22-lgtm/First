"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { searchAddress } from "@/lib/mapbox-geocoding";
import { describeDbError } from "@/lib/setup-errors";
import { env } from "@/lib/env";

/** How many to place per run.
 *
 * Small enough to finish inside a server action's budget and to be watched
 * from a phone, large enough that a book of a few thousand is a handful of
 * taps rather than an afternoon. The button says how many are left, so the
 * work is visible rather than mysterious. */
const BATCH = 40;

export interface GeocodeProgress {
  ok: true;
  placed: number;
  failed: number;
  remaining: number;
  message: string;
}

export type GeocodeResult = GeocodeProgress | { ok: false; message: string };

interface Pending {
  id: string;
  name: string;
  import_address: string;
}

/**
 * Turns imported addresses into properties.
 *
 * An address on a contact is text. A property is a place on a map, which needs
 * coordinates, which needs a geocoder — so an import leaves the addresses
 * parked and this puts them on the map. Until it runs, an imported contact
 * appears nowhere that draws a map, which is exactly the "why can't I see my
 * contacts on Project Data" that sends somebody looking for a bug.
 *
 * Run in batches on purpose. Thousands of geocoder calls in one request is a
 * timeout, and a run that dies halfway with no record of what it did is worse
 * than one that does forty and says so.
 */
export async function geocodeImportedAddresses(): Promise<GeocodeResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!env.mapboxToken) {
      return { ok: false, message: "Address lookup needs a Mapbox token on the server." };
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("customers")
      .select("id, name, import_address")
      .not("import_address", "is", null)
      .is("geocode_attempted_at", null)
      .limit(BATCH);
    if (error) return { ok: false, message: describeDbError(error) };

    const pending = (data ?? []) as unknown as Pending[];
    if (pending.length === 0) {
      return { ok: true, placed: 0, failed: 0, remaining: 0, message: "Every imported address is placed." };
    }

    let placed = 0;
    let failed = 0;

    for (const contact of pending) {
      const attemptedAt = new Date().toISOString();

      // Somebody may already have added this property by hand. Creating a
      // second one at the same address would put two pins on one house.
      const { data: already } = await supabase
        .from("properties")
        .select("id")
        .eq("customer_id", contact.id)
        .limit(1);

      if (already && already.length > 0) {
        await supabase
          .from("customers")
          .update({ geocode_attempted_at: attemptedAt, geocode_error: null })
          .eq("id", contact.id);
        continue;
      }

      let match: { lat: number; lng: number; fullAddress: string } | null = null;
      let failure: string | null = null;

      try {
        const results = await searchAddress(contact.import_address);
        match = results[0] ?? null;
        if (!match) failure = "No match for that address";
      } catch (err) {
        failure = err instanceof Error ? err.message : "Lookup failed";
      }

      if (!match) {
        failed++;
        await supabase
          .from("customers")
          .update({ geocode_attempted_at: attemptedAt, geocode_error: failure })
          .eq("id", contact.id);
        continue;
      }

      const { error: insertError } = await supabase.from("properties").insert({
        customer_id: contact.id,
        // The geocoder's own wording, not ours: it is the version that matches
        // what the coordinates actually point at.
        address: match.fullAddress,
        lat: match.lat,
        lng: match.lng,
      });

      if (insertError) {
        failed++;
        await supabase
          .from("customers")
          .update({ geocode_attempted_at: attemptedAt, geocode_error: insertError.message })
          .eq("id", contact.id);
        continue;
      }

      placed++;
      await supabase
        .from("customers")
        .update({ geocode_attempted_at: attemptedAt, geocode_error: null })
        .eq("id", contact.id);
    }

    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .not("import_address", "is", null)
      .is("geocode_attempted_at", null);

    const remaining = count ?? 0;

    // Both draw from properties, and both were empty of these contacts until
    // now.
    revalidatePath("/contacts");
    revalidatePath("/attractors");

    return {
      ok: true,
      placed,
      failed,
      remaining,
      message: [
        `${placed} placed`,
        failed > 0 ? `${failed} couldn't be found` : null,
        remaining > 0 ? `${remaining} to go` : "all done",
      ]
        .filter(Boolean)
        .join(", "),
    };
  } catch (err) {
    console.error("geocodeImportedAddresses failed:", err);
    return { ok: false, message: "Couldn't place those addresses — try again." };
  }
}

/** How much is waiting, for the button's label. */
export async function countPendingGeocodes(): Promise<{ pending: number; failed: number }> {
  try {
    const supabase = await createClient();
    const [{ count: pending }, { count: failed }] = await Promise.all([
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .not("import_address", "is", null)
        .is("geocode_attempted_at", null),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .not("geocode_error", "is", null),
    ]);
    return { pending: pending ?? 0, failed: failed ?? 0 };
  } catch {
    return { pending: 0, failed: 0 };
  }
}
