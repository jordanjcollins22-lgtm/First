/**
 * What the rank tracker watches, without anybody typing a phrase.
 *
 * The tracker was built and sat empty: no phrases, no scans. A landscaper in
 * Harford County is found by "<service> <town>", so the phrases are every
 * town crossed with every core service, both lists editable in settings.
 * The weekly check takes the phrases checked longest ago first, a capped
 * number a week, so the Places bill stays a few dollars.
 *
 * Pure.
 */

/** Rough centres of the towns, for the grid each phrase is checked round. */
export const TOWN_CENTRES: Record<string, { lat: number; lng: number }> = {
  "bel air": { lat: 39.5359, lng: -76.3483 },
  "forest hill": { lat: 39.5801, lng: -76.388 },
  fallston: { lat: 39.5145, lng: -76.4111 },
  abingdon: { lat: 39.4668, lng: -76.3016 },
  aberdeen: { lat: 39.5096, lng: -76.1641 },
  "havre de grace": { lat: 39.5493, lng: -76.0916 },
  joppa: { lat: 39.429, lng: -76.355 },
  jarrettsville: { lat: 39.6043, lng: -76.4772 },
  street: { lat: 39.6587, lng: -76.3602 },
  churchville: { lat: 39.5637, lng: -76.248 },
};

export const DEFAULT_CENTRE = TOWN_CENTRES["bel air"];

/** "lawn care Bel Air MD". */
export function phraseFor(service: string, town: string): string {
  return `${service.trim().toLowerCase()} ${town.trim()} MD`;
}

/** Every town × service phrase, in a stable order. */
export function seedPhrases(towns: readonly string[], services: readonly string[]): string[] {
  const out: string[] = [];
  for (const town of towns) for (const service of services) out.push(phraseFor(service, town));
  return [...new Set(out)];
}

/** The phrases not yet tracked (compared without case). */
export function missingPhrases(wanted: readonly string[], tracked: readonly string[]): string[] {
  const have = new Set(tracked.map((p) => p.trim().toLowerCase()));
  return wanted.filter((p) => !have.has(p.trim().toLowerCase()));
}

/** Where to check a phrase from: the town named in it, else the default. */
export function centreFor(phrase: string): { lat: number; lng: number } {
  const p = phrase.toLowerCase();
  // Longest names first, so "havre de grace" wins over a shorter overlap.
  const towns = Object.keys(TOWN_CENTRES).sort((a, b) => b.length - a.length);
  for (const town of towns) {
    if (new RegExp(`\\b${town.replace(/ /g, "\\s+")}\\b`).test(p)) return TOWN_CENTRES[town];
  }
  return DEFAULT_CENTRE;
}

/** This week's phrases: never checked first, then checked longest ago. */
export function pickForWeek<T extends { lastScanAt: string | null }>(keywords: readonly T[], perWeek: number): T[] {
  return [...keywords]
    .sort((a, b) => {
      if (!a.lastScanAt && !b.lastScanAt) return 0;
      if (!a.lastScanAt) return -1;
      if (!b.lastScanAt) return 1;
      return a.lastScanAt.localeCompare(b.lastScanAt);
    })
    .slice(0, Math.max(0, perWeek));
}

/** Whether a phrase was checked in the last six days (so a re-run does not pay twice). */
export function checkedThisWeek(lastScanAt: string | null, now: Date): boolean {
  return Boolean(lastScanAt && now.getTime() - Date.parse(lastScanAt) < 6 * 86_400_000);
}
