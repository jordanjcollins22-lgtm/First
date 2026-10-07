/**
 * The ad click a visit came from.
 *
 * Google and Facebook add a click id to the link when somebody taps an ad
 * (?gclid=, ?fbclid=), and an ad can carry utm tags of its own. Read off the
 * address the visitor landed on, carried through our tracked links, and kept
 * with the booking, so a sold job can be traced back to the ad that found it.
 * Pure, so it is tested without a browser.
 */

/** The parameters worth carrying from an ad to the booking. */
export const AD_PARAMS = ["fbclid", "gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign"] as const;
export type AdParam = (typeof AD_PARAMS)[number];

export type AdClick = Partial<Record<AdParam, string>> & {
  /** Meta's browser cookie, when their pixel has set one. */
  fbp?: string;
};

const SAFE = /^[\w.~-]{1,500}$/;
const SAFE_TAG = /^[\w .:/~+-]{1,100}$/;

/** The ad parameters on a query string and Meta's cookie, or null when it wasn't an ad click. */
export function readAdClick(search: string, cookie = ""): AdClick | null {
  const params = new URLSearchParams(search);
  const click: AdClick = {};
  for (const key of AD_PARAMS) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (key.startsWith("utm_") ? SAFE_TAG.test(value) : SAFE.test(value)) click[key] = value;
  }
  const fbp = cookie.match(/(?:^|;\s*)_fbp=([^;]+)/)?.[1];
  if (fbp && /^fb\.\d\.\d+\.\d+$/.test(fbp)) click.fbp = fbp;
  return Object.keys(click).length > 0 ? click : null;
}

/** An ad click sent from a browser, put back through the same checks rather than trusted. */
export function cleanAdClick(raw: unknown): AdClick | null {
  if (!raw || typeof raw !== "object") return null;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === "string" && (AD_PARAMS as readonly string[]).includes(e[0])
  );
  const fbp = (raw as { fbp?: unknown }).fbp;
  return readAdClick(new URLSearchParams(entries).toString(), typeof fbp === "string" ? `_fbp=${fbp}` : "");
}

/** Copies the ad parameters from where somebody arrived onto where they are sent next. */
export function carryAdParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const key of AD_PARAMS) {
    const value = from.get(key);
    if (value && !to.has(key)) to.set(key, value);
  }
}

/** True when the click came from a paid ad rather than only a tagged link. */
export function isPaidClick(click: AdClick | null): boolean {
  return Boolean(click && (click.fbclid || click.gclid || click.gbraid || click.wbraid || click.utm_medium?.toLowerCase() === "cpc" || click.utm_medium?.toLowerCase() === "paid"));
}

/**
 * Where a new client came from, in words for their record: the ad, the
 * tracked link, or the booking page on its own.
 */
export function bookingSource(click: AdClick | null, referralCode: string | null): string {
  if (click?.gclid || click?.gbraid || click?.wbraid) return click.utm_campaign ? `Google ad · ${click.utm_campaign}` : "Google ad";
  if (click?.fbclid) return click.utm_campaign ? `Facebook ad · ${click.utm_campaign}` : "Facebook ad";
  if (click?.utm_source) return [click.utm_source, click.utm_campaign].filter(Boolean).join(" · ").slice(0, 80);
  if (referralCode) return `Tracked link ${referralCode}`;
  return "Booked online";
}
