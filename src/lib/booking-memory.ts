/**
 * What this browser already knows about the person filling the form in.
 *
 * Booking a second evaluation meant typing the same name, email, phone number
 * and address a second time, on a phone, having already given us all of it.
 * A payment sheet does not do that: you tap it, it recognises you, and the
 * work is confirming rather than typing.
 *
 * This is the same trick and nothing cleverer. After a booking goes through,
 * what the person typed is kept in their own browser and offered back to them
 * the next time they open the form — as one card they accept or dismiss, at
 * the top, before anything is asked.
 *
 * It never leaves the device and it is never read by us. There is no account
 * behind it and nothing is looked up by email, because a form that says "we
 * know you" to a stranger who typed somebody else's address is a form that
 * has leaked. What this returns is only ever what this browser typed.
 */

export const MEMORY_KEY = "booking:last";

/** How long remembered details are worth offering back. */
export const REMEMBER_DAYS = 180;

export interface RememberedBooking {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  /** When it was saved, so stale details are dropped rather than offered. */
  savedAt: string;
}

/** Everything a card needs, without the caller reaching into the shape. */
export interface RememberedSummary {
  name: string;
  address: string;
  /** "jordan@…" and the last four of the phone, for recognising at a glance. */
  contact: string;
}

/**
 * Read back what was stored, or null.
 *
 * Null for anything the slightest bit wrong: missing fields, an unparseable
 * blob, details older than half a year, a browser that refuses storage. The
 * whole feature is a convenience, so every failure is simply the form as it
 * was before.
 */
export function readRemembered(
  raw: string | null | undefined,
  now: Date = new Date()
): RememberedBooking | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const r = parsed as Record<string, unknown>;
  const text = (key: string) => (typeof r[key] === "string" ? (r[key] as string).trim() : "");
  const firstName = text("firstName");
  const lastName = text("lastName");
  const email = text("email");
  const phone = text("phone");
  const address = text("address");
  const savedAt = text("savedAt");
  // Numbers only. `Number(null)` is 0 and 0,0 is a spot in the Atlantic, so a
  // record with a missing pin would otherwise come back looking usable and
  // send the times endpoint to sea.
  const lat = typeof r.lat === "number" ? r.lat : Number.NaN;
  const lng = typeof r.lng === "number" ? r.lng : Number.NaN;

  if (!firstName || !lastName || !email || !phone || !address) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return null;
  const days = (now.getTime() - saved.getTime()) / 86_400_000;
  // Ahead of now as well as long past: a device with a wrong clock should get
  // the plain form, not details it cannot explain.
  if (days > REMEMBER_DAYS || days < -1) return null;

  return { firstName, lastName, email, phone, address, lat, lng, savedAt };
}

/** What to store after a booking, as a string, or null if there is nothing worth keeping. */
export function rememberBooking(
  booking: Omit<RememberedBooking, "savedAt">,
  now: Date = new Date()
): string | null {
  if (!booking.firstName?.trim() || !booking.email?.trim() || !booking.address?.trim()) return null;
  return JSON.stringify({ ...booking, savedAt: now.toISOString() });
}

/** How to describe them back to themselves. */
export function summarise(remembered: RememberedBooking): RememberedSummary {
  const digits = remembered.phone.replace(/\D/g, "");
  const tail = digits.length >= 4 ? `••• ${digits.slice(-4)}` : remembered.phone;
  return {
    name: `${remembered.firstName} ${remembered.lastName}`.trim(),
    address: remembered.address,
    contact: `${remembered.email} · ${tail}`,
  };
}
