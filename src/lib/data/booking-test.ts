import { createClient } from "@/lib/supabase/server";
import { summariseTest, type AddressVariant, type LocateResult, type TestSummary } from "@/lib/booking-test";

/** The address test so far, for the owner's board. */
export async function getBookingTest(): Promise<TestSummary & { since: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_visits")
    .select("variant, agent, located_tapped, located_result, booked_job_id, created_at")
    .order("created_at", { ascending: true })
    .limit(5000);
  const rows = (data ?? []) as { variant: string; agent: string; located_tapped: boolean; located_result: string | null; booked_job_id: string | null; created_at: string }[];
  const summary = summariseTest(
    rows.map((r) => ({
      variant: r.variant as AddressVariant,
      agent: r.agent,
      locatedTapped: r.located_tapped,
      locatedResult: r.located_result as LocateResult | null,
      booked: r.booked_job_id != null,
    }))
  );
  return { ...summary, since: rows[0]?.created_at ?? null };
}
