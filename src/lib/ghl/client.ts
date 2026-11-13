import { serverEnv } from "@/lib/env";

/**
 * Minimal GoHighLevel (LeadConnector) API v2 client — just what check-ins need:
 * upsert a contact for a team member, and send them an SMS.
 * Auth is a Private Integration token scoped to one sub-account (location).
 */

const BASE_URL = "https://services.leadconnectorhq.com";

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GhlError";
  }
}

async function ghlFetch<T>(path: string, init: { method: string; body: unknown; version: string }) {
  if (!serverEnv.ghlApiKey || !serverEnv.ghlLocationId) {
    throw new GhlError("GoHighLevel is not configured (GHL_API_KEY / GHL_LOCATION_ID).");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${serverEnv.ghlApiKey}`,
      Version: init.version,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(init.body),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new GhlError(`GoHighLevel ${init.method} ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Create or update the GHL contact for a team member. Tagged "team-member" so
 * your client-facing GHL workflows can filter internal staff out.
 */
export async function upsertTeamMemberContact(input: { name: string; phone: string }): Promise<string> {
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const data = await ghlFetch<{ contact?: { id?: string } }>("/contacts/upsert", {
    method: "POST",
    version: "2021-07-28",
    body: {
      locationId: serverEnv.ghlLocationId,
      firstName,
      lastName: rest.join(" ") || undefined,
      name: input.name,
      phone: input.phone,
      tags: ["team-member"],
      source: "Field Estimator team check-ins",
    },
  });
  const id = data.contact?.id;
  if (!id) throw new GhlError("GoHighLevel contact upsert returned no contact id.");
  return id;
}

/**
 * Create or update the GHL contact for an Apex Shine detailing funnel lead, so
 * new leads land in the CRM alongside everything else.
 */
export async function upsertDetailingLeadContact(input: {
  name: string;
  phone: string;
  email: string;
  address: string;
  tags: string[];
}): Promise<string> {
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const data = await ghlFetch<{ contact?: { id?: string } }>("/contacts/upsert", {
    method: "POST",
    version: "2021-07-28",
    body: {
      locationId: serverEnv.ghlLocationId,
      firstName,
      lastName: rest.join(" ") || undefined,
      name: input.name,
      phone: input.phone,
      email: input.email,
      address1: input.address,
      tags: input.tags,
      source: "Apex Shine Mobile booking funnel",
    },
  });
  const id = data.contact?.id;
  if (!id) throw new GhlError("GoHighLevel contact upsert returned no contact id.");
  return id;
}

export async function sendSms(input: { contactId: string; message: string }) {
  return ghlFetch<{ messageId?: string; conversationId?: string }>("/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body: { type: "SMS", contactId: input.contactId, message: input.message },
  });
}

/** GHL's `type` for POST /conversations/messages, per channel. */
const SEND_TYPE: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  facebook: "FB",
  instagram: "IG",
  whatsapp: "WhatsApp",
  gmb: "GMB",
  live_chat: "Live_Chat",
};

/**
 * Reply to a contact on any channel GHL handles. GHL picks the right
 * conversation, number, inbox or page from the contact and the type.
 */
export async function sendMessage(input: {
  contactId: string;
  channel: string;
  message: string;
  subject?: string | null;
}) {
  const type = SEND_TYPE[input.channel];
  if (!type) throw new GhlError(`Can't send on channel "${input.channel}".`);

  const body: Record<string, unknown> = { type, contactId: input.contactId, message: input.message };
  if (type === "Email") {
    body.subject = input.subject || "Re: your message";
    body.html = input.message
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  return ghlFetch<{ messageId?: string; conversationId?: string }>("/conversations/messages", {
    method: "POST",
    version: "2021-04-15",
    body,
  });
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
