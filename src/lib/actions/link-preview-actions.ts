"use server";

export interface LinkPreview {
  title: string | null;
  description: string | null;
  price: number | null;
}

const EMPTY_PREVIEW: LinkPreview = { title: null, description: null, price: null };

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractPriceFromJsonLd(html: string): number | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const item of candidates) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const offers = record.offers;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      const rawPrice = (offer as Record<string, unknown> | undefined)?.price;
      if (rawPrice != null) {
        const price = Number(rawPrice);
        if (!Number.isNaN(price)) return price;
      }
    }
  }
  return null;
}

/**
 * Best-effort product info from a URL's Open Graph tags / JSON-LD structured
 * data. Works for many storefronts; sites that render price via JS or block
 * scrapers (Amazon, big-box retailers, etc.) will often come back empty --
 * callers must handle nulls gracefully, not treat this as reliable.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return EMPTY_PREVIEW;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return EMPTY_PREVIEW;

  let html: string;
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return EMPTY_PREVIEW;
    const full = await res.text();
    html = full.slice(0, 500_000);
  } catch {
    return EMPTY_PREVIEW;
  }

  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);

  const description = firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  let price: number | null = null;
  const priceMeta = firstMatch(html, [
    /<meta[^>]+property=["'](?:og|product):price:amount["'][^>]+content=["']([^"']+)["']/i,
  ]);
  if (priceMeta) {
    const n = Number(priceMeta.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(n)) price = n;
  }
  if (price === null) price = extractPriceFromJsonLd(html);

  return {
    title: title ? decodeHtmlEntities(title) : null,
    description: description ? decodeHtmlEntities(description) : null,
    price,
  };
}
