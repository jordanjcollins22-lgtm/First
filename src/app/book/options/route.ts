import { NextResponse, type NextRequest } from "next/server";

import { loadBookingOptions } from "@/lib/data/booking-options";
import { isSupabaseConfigured } from "@/lib/env";

import type { BookingOptions } from "../booking-options";

/**
 * The dynamic half of the public booking page.
 *
 * /book itself is now a prerendered shell: the same bytes for everybody, out
 * of the edge cache, with no database behind it. This is what that shell asks
 * for once it is on screen — who the link belongs to, what that business
 * offers, and which hours are still free.
 *
 * It is deliberately not cached. Open times are the one thing on this page
 * that must not be stale: a client picking an hour that was taken two minutes
 * ago gets sent back to the calendar by the server-side re-check in
 * submitPublicBooking, which is a worse first impression than the second this
 * query costs. Everything that *can* be stale was moved into the shell.
 */
export async function GET(request: NextRequest): Promise<NextResponse<BookingOptions>> {
  const answer = (body: BookingOptions) =>
    NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

  if (!isSupabaseConfigured) {
    return answer({ status: "unavailable" });
  }

  const ref = request.nextUrl.searchParams.get("ref") ?? undefined;
  const org = request.nextUrl.searchParams.get("org") ?? undefined;
  // The last resort. A posted reply's code knows which business it belongs to,
  // which is what keeps links already pasted into other people's threads
  // working after whatever else they named has gone.
  const rec = request.nextUrl.searchParams.get("rec") ?? undefined;

  return answer(await loadBookingOptions({ ref, org, rec }));
}
