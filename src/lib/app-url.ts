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
 * Three sources, in order:
 *
 *  1. `configured` — an explicit override, for when the automatic answer is
 *     wrong (several custom domains on one project, say).
 *  2. `productionDomain` — Vercel hands the project's production domain to
 *     every deployment at runtime, and that is the custom domain once one is
 *     attached. Nothing to set up, and a preview deployment still writes
 *     links pointing at the real site rather than at itself.
 *  3. The request host, so local development works with no domain at all.
 */
export function resolveBaseUrl(input: {
  configured: string;
  productionDomain?: string;
  host: string | null;
  proto?: string | null;
}): string {
  const configured = normalizeBaseUrl(input.configured);
  if (configured) return configured;

  const production = normalizeBaseUrl(input.productionDomain ?? "");
  if (production) return production;

  if (!input.host) return "";
  return `${input.proto || "https"}://${input.host}`;
}

/** Joins a path onto a base without doubling or dropping the slash. */
export function appUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
