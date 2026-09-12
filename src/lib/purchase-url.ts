/**
 * Making a pasted link safe to put in an href.
 *
 * This matters more than it looks. A "purchase link" is free text somebody
 * types, and it ends up as the href of a link other people in the business
 * click. `javascript:` in that box is a script of their choosing running
 * inside the app, as them.
 *
 * Only http and https survive. A bare domain is given https rather than
 * refused, because "uline.com" is what people actually paste and refusing it
 * teaches them the field is broken.
 */
export function safePurchaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A scheme with no host is not somewhere you can buy anything.
    if (!url.hostname || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The bit worth showing on a phone: the shop, not the whole tracking query. */
export function describePurchaseUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
