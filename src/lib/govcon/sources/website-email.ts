/**
 * Find a contact email on a small business's website (Places gives phone +
 * website, never email). Checks the homepage, then common contact pages.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
const JUNK = /(example\.|sentry|wixpress|godaddy|domain\.com|email\.com|yourdomain|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.svg$|@2x|noreply|no-reply|privacy@|abuse@|webmaster@)/i;
const PREFERRED = /^(info|office|contact|sales|estimates?|quotes?|bids?|admin|service|hello)@/i;

export function extractEmails(html: string): string[] {
  const decoded = html.replace(/&#64;|&#x40;|\s*\[at\]\s*|\s*\(at\)\s*/gi, "@").replace(/%40/g, "@");
  const found = new Set<string>();
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/^mailto:/, "");
    if (!JUNK.test(e)) found.add(e);
  }
  return [...found];
}

/** Prefer an address on the site's own domain, then generic inboxes. */
export function pickBestEmail(emails: string[], website: string | null): string | null {
  if (!emails.length) return null;
  let host = "";
  try {
    host = website ? new URL(website).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const rank = (e: string) => (host && e.endsWith(`@${host}`) ? 2 : 0) + (PREFERRED.test(e) ? 1 : 0);
  return [...emails].sort((a, b) => rank(b) - rank(a))[0];
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GovconSubFinder/1.0)" },
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

export async function findEmailOnWebsite(website: string): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }
  const pages = ["", "/contact", "/contact-us", "/about", "/about-us"];
  const all: string[] = [];
  for (const path of pages) {
    const html = await getText(new URL(path || "/", base.origin).toString());
    if (!html) continue;
    all.push(...extractEmails(html));
    const best = pickBestEmail(all, website);
    if (best) return best;
  }
  return null;
}
