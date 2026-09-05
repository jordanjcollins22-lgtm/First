import type { AvailableSlotGroup } from "@/lib/booking-availability";
import type { PublicService } from "@/lib/data/public-booking";

/**
 * Everything the booking form needs that the database has to answer for.
 *
 * The page itself is the same HTML for every visitor, so it is prerendered
 * and served from the edge; this is the part that genuinely differs per link
 * and per minute, fetched separately once the page is on screen. Keeping the
 * shape in its own module lets the route handler and the form agree on it
 * without the form importing anything that touches Supabase.
 *
 * The failure cases are values rather than error codes because each one is a
 * different sentence shown to a member of the public, and none of them is a
 * fault they can do anything about.
 */
export type BookingOptions =
  /** No Supabase configured at all — a fresh deployment nobody has set up yet. */
  | { status: "unavailable" }
  /** The ?ref= or ?org= in the link matches nothing, or there was no link. */
  | { status: "unknown-link" }
  /** The link is good, but the business has nobody who can be booked. */
  | { status: "closed" }
  | {
      status: "ok";
      organizationId: string;
      organizationName: string;
      referredByProfileId: string | null;
      services: PublicService[];
      slots: AvailableSlotGroup[];
    };
