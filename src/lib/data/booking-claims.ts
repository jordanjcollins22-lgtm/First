import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * One booking, made once (see migration 0349).
 *
 * Taken before a booking makes anything. The first request for a key wins it
 * and goes on to make the booking; a second arriving at the same moment
 * loses, waits for the first to finish, and is handed the same job. A claim
 * whose maker failed is let go, so the booking can be tried again; one left
 * with no job for a minute is taken over.
 */

export type Claim = { won: true } | { won: false; jobId: string | null };

const WAIT_MS = 10_000;
const STEP_MS = 400;
/** A claim this old with no job behind it was left by a request that died. */
const STALE_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function claimBooking(admin: Admin, key: string): Promise<Claim> {
  const { error } = await admin.from("booking_claims").insert({ key });
  if (!error) return { won: true };
  // Anything but "taken" is not a reason to refuse a booking.
  if (error.code !== "23505") return { won: true };

  const started = Date.now();
  for (;;) {
    const { data } = await admin.from("booking_claims").select("job_id, created_at").eq("key", key).maybeSingle();
    if (!data) {
      // Let go while we waited: try for it again.
      const retry = await admin.from("booking_claims").insert({ key });
      if (!retry.error) return { won: true };
    } else if (data.job_id) {
      return { won: false, jobId: data.job_id };
    } else if (Date.now() - new Date(data.created_at).getTime() > STALE_MS) {
      const { data: taken } = await admin
        .from("booking_claims")
        .update({ created_at: new Date().toISOString() })
        .eq("key", key)
        .is("job_id", null)
        .eq("created_at", data.created_at)
        .select("key")
        .maybeSingle();
      if (taken) return { won: true };
    }
    if (Date.now() - started > WAIT_MS) return { won: false, jobId: null };
    await sleep(STEP_MS);
  }
}

/** The job the claim made, for any copy still waiting on it. */
export async function settleClaim(admin: Admin, key: string, jobId: string): Promise<void> {
  await admin.from("booking_claims").update({ job_id: jobId }).eq("key", key);
}

/** The maker failed: let the claim go so the booking can be tried again. */
export async function releaseClaim(admin: Admin, key: string): Promise<void> {
  await admin.from("booking_claims").delete().eq("key", key).is("job_id", null);
}

/** The key for a booking made on our own booking page: who, for which visit. */
export function bookingPageKey(organizationId: string, email: string, startsAtIso: string): string {
  return `book:${organizationId}:${email.trim().toLowerCase()}:${startsAtIso}`;
}

/** The key for an appointment from the GoHighLevel calendar. */
export function ghlKey(appointmentId: string): string {
  return `ghl:${appointmentId}`;
}
