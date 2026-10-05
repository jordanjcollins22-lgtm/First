import { env } from "@/lib/env";
import type { DnsRecord, DomainStatus } from "@/lib/sending-domains";
import { inDemo } from "@/lib/demo-mode";
import { DEMO_BLOCKED } from "@/lib/demo-guard";

/**
 * Resend, over plain fetch.
 *
 * No SDK: this uses four endpoints, and a dependency that ships its own fetch
 * wrapper and its own types is more surface than the thing it replaces.
 *
 * Everything here returns a result rather than throwing. A DNS provider being
 * slow, an API key being wrong, a domain being deleted in the Resend
 * dashboard — none of those are exceptional, they are Tuesday, and each one
 * needs to reach the person setting this up as a sentence.
 */

const API = "https://api.resend.com";

export type ResendResult<T> = { ok: true; data: T } | { ok: false; message: string };

export const isEmailConfigured = Boolean(env.resendApiKey);

async function call<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" }
): Promise<ResendResult<T>> {
  if (!env.resendApiKey) {
    return { ok: false, message: "Email isn't connected yet, RESEND_API_KEY is not set." };
  }
  // A demo sends nothing (lib/demo-guard.ts); looking something up is fine.
  if (init.method !== "GET" && (await inDemo())) return { ok: false, message: DEMO_BLOCKED };

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `Couldn't reach Resend: ${err.message}` : "Couldn't reach Resend.",
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body from an API that only speaks JSON means something is in
    // front of it — a proxy, an outage page. Say so rather than "undefined".
    return { ok: false, message: `Resend returned something unexpected (${response.status}).` };
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Resend rejected that (${response.status}).`;
    return { ok: false, message };
  }

  return { ok: true, data: parsed as T };
}

export interface ProviderDomain {
  id: string;
  name: string;
  status: DomainStatus;
  records: DnsRecord[];
}

interface RawDomain {
  id: string;
  name: string;
  status?: string;
  records?: {
    record?: string;
    type?: string;
    name?: string;
    value?: string;
    status?: string;
    priority?: number;
    ttl?: string;
  }[];
}

/**
 * Resend's own words for where a domain has got to, mapped onto ours.
 *
 * "not_started", "pending" and "temporary_failure" are all one thing to the
 * person reading the screen: the records are not in yet, keep waiting. Only a
 * hard failure is worth a different sentence, because only a hard failure
 * means going back and checking what was typed.
 */
function toStatus(raw: string | undefined): DomainStatus {
  if (raw === "verified") return "verified";
  if (raw === "failure") return "failed";
  return "pending";
}

function toRecords(raw: RawDomain["records"]): DnsRecord[] {
  return (raw ?? []).map((r) => ({
    type: (r.type ?? r.record ?? "TXT").toUpperCase(),
    name: r.name ?? "",
    value: r.value ?? "",
    status: r.status ?? null,
    priority: r.priority ?? null,
  }));
}

function toDomain(raw: RawDomain): ProviderDomain {
  return {
    id: raw.id,
    name: raw.name,
    status: toStatus(raw.status),
    records: toRecords(raw.records),
  };
}

/** Register a domain and get back the DNS the owner has to add. */
export async function createProviderDomain(hostname: string): Promise<ResendResult<ProviderDomain>> {
  const result = await call<RawDomain>("/domains", { method: "POST", body: { name: hostname } });
  return result.ok ? { ok: true, data: toDomain(result.data) } : result;
}

/** Ask again whether the DNS has landed. */
export async function getProviderDomain(id: string): Promise<ResendResult<ProviderDomain>> {
  const result = await call<RawDomain>(`/domains/${id}`);
  return result.ok ? { ok: true, data: toDomain(result.data) } : result;
}

/** Nudge Resend to re-read the DNS now rather than on its own schedule. */
export async function verifyProviderDomain(id: string): Promise<ResendResult<null>> {
  const result = await call<unknown>(`/domains/${id}/verify`, { method: "POST" });
  return result.ok ? { ok: true, data: null } : result;
}

/** Stop sending from a domain, at the provider as well as here. */
export async function deleteProviderDomain(id: string): Promise<ResendResult<null>> {
  const result = await call<unknown>(`/domains/${id}`, { method: "DELETE" });
  return result.ok ? { ok: true, data: null } : result;
}

export interface SendEmailInput {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
  /** Extra headers, for threading a sequence under its first message. */
  headers?: Record<string, string>;
}

/** Send one message. Returns the provider's id for it. */
export async function sendProviderEmail(input: SendEmailInput): Promise<ResendResult<{ id: string }>> {
  return call<{ id: string }>("/emails", {
    method: "POST",
    body: {
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      // Several reply addresses are kept as one comma-separated setting, so a
      // reply can reach the office's own inbox and the app's at once.
      reply_to: replyAddresses(input.replyTo),
      headers: input.headers,
    },
  });
}

function replyAddresses(value: string | null | undefined): string[] | undefined {
  const list = (value ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  created_at: string;
  message_id: string | null;
  /** Who a reply should go to, when the sender set it (Indeed's reaches the applicant). */
  reply_to?: string | string[] | null;
  authentication: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null;
}

/** One email somebody sent us, with its body. The webhook only says it arrived. */
export async function getReceivedEmail(id: string): Promise<ResendResult<ReceivedEmail>> {
  return call<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(id)}`);
}
