import { accessTokenFor, type OAuthConfigResolver } from "@/lib/integrations/oauth";
import { getIntegration } from "@/lib/integrations/store";

/**
 * Talking to QuickBooks Online as the business. Server only.
 *
 * The owner pastes their Intuit app's Client ID and Client secret on the
 * Integrations page, presses Connect, and picks the company. The company's
 * id (Intuit calls it the realm) comes back on the callback and is kept in
 * the integration's settings; the tokens are kept in its secrets and
 * refreshed by the shared OAuth helpers.
 */

export const QBO_PROVIDER = "quickbooks";
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_MINOR_VERSION = "75";

export function qboApiBase(environment: unknown): string {
  return environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
}

const read = (secrets: Record<string, string>, settings: Record<string, unknown>, key: string) =>
  (typeof settings[key] === "string" && (settings[key] as string)) || secrets[key] || "";

export const quickbooksOAuth: OAuthConfigResolver = ({ secrets, settings, redirectUri }) => {
  const clientId = read(secrets, settings, "client_id");
  const clientSecret = read(secrets, settings, "client_secret");
  if (!clientId || !clientSecret) return "Save the QuickBooks Client ID and Client secret first, then press Connect.";
  return {
    provider: QBO_PROVIDER,
    authorizeUrl: QBO_AUTHORIZE_URL,
    tokenUrl: QBO_TOKEN_URL,
    clientId,
    clientSecret,
    scopes: ["com.intuit.quickbooks.accounting"],
    redirectUri,
    clientAuth: "basic",
  };
};

export class QboError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Intuit's error code, e.g. "6240" for a duplicate name. */
    readonly code: string | null
  ) {
    super(message);
  }
}

export interface QboClient {
  realmId: string;
  request<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    opts?: { body?: unknown; query?: Record<string, string> }
  ): Promise<T>;
}

/** Reads Intuit's error envelope into one sentence and its code. */
export function qboErrorFrom(status: number, json: unknown): QboError {
  const fault = (json as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } })?.Fault?.Error?.[0];
  const message = fault ? [fault.Message, fault.Detail].filter(Boolean).join(": ") : `QuickBooks answered ${status}`;
  return new QboError(message.slice(0, 500), status, fault?.code ?? null);
}

/** A request function bound to a token and company. Exposed for the provider's Test, which has no organization. */
export function qboClientWith(accessToken: string, realmId: string, environment: unknown): QboClient {
  const base = `${qboApiBase(environment)}/v3/company/${encodeURIComponent(realmId)}`;
  return {
    realmId,
    async request(method, path, opts) {
      const url = new URL(`${base}/${path.replace(/^\//, "")}`);
      url.searchParams.set("minorversion", QBO_MINOR_VERSION);
      for (const [k, v] of Object.entries(opts?.query ?? {})) url.searchParams.set(k, v);
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(opts?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok || (json as { Fault?: unknown })?.Fault) throw qboErrorFrom(res.status, json);
      return json as never;
    },
  };
}

/** A client for the business's QuickBooks company, or why there isn't one. */
export async function qboClientFor(organizationId: string): Promise<{ client: QboClient; settings: Record<string, unknown> } | { error: string }> {
  const row = await getIntegration(organizationId, QBO_PROVIDER);
  if (!row || row.status === "not_connected") return { error: "QuickBooks is not connected — add it in Settings › Integrations." };
  const realmId = typeof row.settings.realm_id === "string" ? row.settings.realm_id : "";
  if (!realmId) return { error: "QuickBooks has no company picked — press Connect in Settings › Integrations." };
  const token = await accessTokenFor(organizationId, QBO_PROVIDER, quickbooksOAuth);
  if (!token) return { error: "QuickBooks sign-in has expired — press Connect again in Settings › Integrations." };
  return { client: qboClientWith(token, realmId, row.settings.environment), settings: row.settings };
}
