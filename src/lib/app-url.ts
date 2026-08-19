/**
 * The address the business is known by.
 *
 * Links that leave the app — a proposal a client opens, a booking link on a
 * business card — were built from whatever host served the request. That is
 * whatever Vercel happened to answer on, so the same proposal could go out as
 * a project-hash preview URL one day and the real domain the next. A client
 * seeing a link that does not match the company is a client who wonders
 * whether it is really from them.
 *
 * So the custom domain wins when it is configured, and the request host is the
 * fallback rather than the default.
 *
 * Deliberately not used for Twilio's signature check: that has to be the URL
 * Twilio actually called, whatever it was, or every webhook fails validation.
 */

/** Trims a trailing slash and adds https:// when the scheme was left off —
 * somebody setting this env var will type "app.example.com" as often as not. */
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Picks the base URL for a link somebody outside the app will follow.
 *
 * `configured` is the custom domain. `host`/`proto` come from the request and
 * are used only when no domain is set, so nothing breaks before it is.
 */
export function resolveBaseUrl(input: {
  configured: string;
  host: string | null;
  proto?: string | null;
}): string {
  const configured = normalizeBaseUrl(input.configured);
  if (configured) return configured;

  if (!input.host) return "";
  return `${input.proto || "https"}://${input.host}`;
}

/** Joins a path onto a base without doubling or dropping the slash. */
export function appUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
