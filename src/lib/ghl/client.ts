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
  /** The GoHighLevel user the appointment is under. Its calendar refuses one without. */
  assignedUserId?: string | null;
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
    assignedUserId: input.assignedUserId || undefined,
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
  patch: {
    title?: string;
    startTime?: string;
    endTime?: string;
    appointmentStatus?: "confirmed" | "cancelled";
    /** Hands the appointment to another GoHighLevel user. */
    assignedUserId?: string;
  }
): Promise<void> {
  await call("PUT", `/calendars/events/appointments/${encodeURIComponent(id)}`, {
    ...patch,
    ...(patch.startTime ? { ignoreFreeSlotValidation: true, ignoreDateRange: true } : {}),
  });
}

export interface GhlCalendarEvent {
  id: string;
  contactId: string | null;
  startTime: string;
  endTime: string | null;
  appointmentStatus: string;
  title: string | null;
  address: string | null;
}

/** Every appointment on the evaluation calendar between two instants. */
export async function listAppointments(startsAfter: Date, endsBefore: Date): Promise<GhlCalendarEvent[]> {
  const query = new URLSearchParams({
    locationId: env.ghlLocationId,
    calendarId: env.ghlCalendarId,
    startTime: String(startsAfter.getTime()),
    endTime: String(endsBefore.getTime()),
  });
  const result = await call<{ events?: Record<string, unknown>[] }>("GET", `/calendars/events?${query.toString()}`);
  return (result.events ?? []).map((e) => ({
    id: String(e.id ?? ""),
    contactId: (e.contactId as string) ?? null,
    startTime: String(e.startTime ?? ""),
    endTime: (e.endTime as string) ?? null,
    appointmentStatus: String(e.appointmentStatus ?? e.status ?? ""),
    title: (e.title as string) ?? null,
    address: (e.address as string) ?? null,
  })).filter((e) => e.id && e.startTime);
}

export interface GhlUser {
  id: string;
  email: string | null;
  name: string | null;
}

/** The team as GoHighLevel knows it, so an evaluator can be matched by email. */
export async function listUsers(): Promise<GhlUser[]> {
  const query = new URLSearchParams({ locationId: env.ghlLocationId });
  const result = await call<{ users?: Record<string, unknown>[] }>("GET", `/users/?${query.toString()}`);
  return (result.users ?? [])
    .map((u) => ({
      id: String(u.id ?? ""),
      email: typeof u.email === "string" ? u.email : null,
      name: (u.name as string) ?? [u.firstName, u.lastName].filter(Boolean).join(" ") ?? null,
    }))
    .filter((u) => u.id);
}

/**
 * A text to a contact, from the number GoHighLevel holds for us.
 *
 * The same conversation the office sees in GoHighLevel, so a reply typed in
 * either place lands in one thread there and, through the webhook, here.
 */
export async function sendSmsMessage(contactId: string, message: string): Promise<string | null> {
  const result = await call<{ messageId?: string; conversationId?: string }>("POST", "/conversations/messages", {
    type: "SMS",
    contactId,
    message,
  });
  return result.messageId ?? null;
}

export interface GhlContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export async function getContact(id: string): Promise<GhlContact | null> {
  try {
    const result = await call<{ contact?: Record<string, unknown> }>("GET", `/contacts/${encodeURIComponent(id)}`);
    const c = result.contact;
    if (!c) return null;
    const parts = [c.address1, c.city, c.state, c.postalCode].filter((v) => typeof v === "string" && v.trim()) as string[];
    return {
      id: String(c.id ?? id),
      firstName: (c.firstName as string) ?? null,
      lastName: (c.lastName as string) ?? null,
      name: (c.name as string) ?? (c.contactName as string) ?? null,
      email: (c.email as string) ?? null,
      phone: (c.phone as string) ?? null,
      address: parts.length > 0 ? parts.join(", ") : null,
    };
  } catch {
    return null;
  }
}
