import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * The GoHighLevel API, the little of it we use.
 *
 * A private integration token from the sub-account's settings, the
 * sub-account (location) id, and the calendar evaluations go on. Every
 * call is one request with the version header the v2 API insists on.
 */
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15";

export const isGhlConfigured = Boolean(env.ghlApiKey && env.ghlLocationId && env.ghlCalendarId);

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.ghlApiKey}`,
      Version: VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    log.warn("ghl.api.failed", { method, path, status: response.status, body: text.slice(0, 300) });
    throw new Error(`GoHighLevel ${method} ${path} returned ${response.status}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface GhlContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

/** Finds or creates the contact by email or phone, and returns its id. */
export async function upsertContact(input: GhlContactInput): Promise<string> {
  const result = await call<{ contact?: { id?: string } }>("POST", "/contacts/upsert", {
    locationId: env.ghlLocationId,
    firstName: input.firstName,
    lastName: input.lastName || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    address1: input.address || undefined,
    source: "JS Landscaping app",
  });
  const id = result.contact?.id;
  if (!id) throw new Error("GoHighLevel did not return a contact id.");
  return id;
}

export interface GhlAppointmentInput {
  contactId: string;
  title: string;
  startTime: string;
  endTime: string;
  address: string | null;
}

export async function createAppointment(input: GhlAppointmentInput): Promise<string> {
  const result = await call<{ id?: string }>("POST", "/calendars/events/appointments", {
    calendarId: env.ghlCalendarId,
    locationId: env.ghlLocationId,
    contactId: input.contactId,
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    address: input.address || undefined,
    appointmentStatus: "confirmed",
    // The app has already checked the evaluator is free; the GoHighLevel
    // calendar's own availability rules must not refuse what we booked.
    ignoreFreeSlotValidation: true,
    ignoreDateRange: true,
  });
  if (!result.id) throw new Error("GoHighLevel did not return an appointment id.");
  return result.id;
}

export async function updateAppointment(
  id: string,
  patch: { title?: string; startTime?: string; endTime?: string; appointmentStatus?: "confirmed" | "cancelled" }
): Promise<void> {
  await call("PUT", `/calendars/events/appointments/${encodeURIComponent(id)}`, {
    ...patch,
    ...(patch.startTime ? { ignoreFreeSlotValidation: true, ignoreDateRange: true } : {}),
  });
}
