import { normalizeAddress } from "@/lib/address-normalize";

/**
 * Turning what a person typed into something the county's addresses can be
 * searched by.
 *
 * People type "128 Post Rd Aberdeen" for what the county calls "128 N POST
 * RD, ABERDEEN, MD 21001". A contains-match on the whole phrase misses it
 * over one absent letter; a match on each word, in any order, does not. The
 * words come out of the same normalizer the keys went through, so "Road" and
 * "RD" are the same word here as they are there.
 */
export function searchTerms(query: string): string[] {
  // "RdAberdeen": a space that went missing between two words. Put it back
  // where a lower-case letter runs into a capital.
  const spaced = query.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = normalizeAddress(spaced).split(" ").filter(Boolean);
  return [...new Set(words)];
}

/**
 * A looser second try when every word together finds nothing: the house
 * number and the longest word, which is nearly always the street name. Empty
 * when there is nothing to loosen to.
 */
export function looserTerms(terms: string[]): string[] {
  if (terms.length < 3) return [];
  const number = terms.find((t) => /^\d/.test(t));
  const street = [...terms].filter((t) => !/^\d/.test(t) && t.length > 2).sort((a, b) => b.length - a.length)[0];
  const loose = [number, street].filter((t): t is string => Boolean(t));
  return loose.length === terms.length ? [] : loose;
}

/** The typed house number's street floats to the top; everything else keeps the database's order. */
export function rankHits<T extends { normalized: string }>(hits: T[], terms: string[]): T[] {
  const number = terms.find((t) => /^\d/.test(t));
  if (!number) return hits;
  const starts = (hit: T) => (hit.normalized.startsWith(`${number} `) ? 0 : 1);
  return [...hits].sort((a, b) => starts(a) - starts(b));
}
