/**
 * The places on this property somebody has already named.
 *
 * An evaluation walks one property, and the same few places come up over and
 * over: the front, the side by the driveway, round the back. Typing "Front
 * yard, near the driveway" a fourth time is both slow on a phone in somebody's
 * garden and a good way to end up with four spellings of one place, which then
 * read as four different places on the crew sheet.
 *
 * So the locations already used on this evaluation are offered back. Tapping
 * one is exact by construction; typing stays available, because the fifth zone
 * genuinely might be somewhere new.
 */

export interface LocatedZone {
  location: string;
}

/** How many to offer. Enough to cover a property, few enough to read without
 * scrolling on a phone held in one hand. */
export const MAX_SUGGESTIONS = 6;

/**
 * Locations already used, most recently first.
 *
 * Most recent rather than most frequent: an evaluator works round a property
 * in order, and the place they named a moment ago is far more likely to be
 * where they still are than the one they named first.
 *
 * `exclude` drops the zone being edited, so its own location is not offered
 * back to it as a suggestion.
 */
export function suggestedLocations(
  zones: LocatedZone[],
  options: { exclude?: string; limit?: number } = {}
): string[] {
  const limit = options.limit ?? MAX_SUGGESTIONS;
  const skip = normalise(options.exclude ?? "");

  const seen = new Set<string>();
  const out: string[] = [];

  // Walked backwards: the last zone named is the first suggestion.
  for (let i = zones.length - 1; i >= 0; i--) {
    // Internal runs of whitespace collapsed, so a stray double space does not
    // come back looking like a mistake somebody has to fix by hand. The
    // wording and the capitals are left exactly as typed.
    const raw = (zones[i].location ?? "").trim().replace(/\s+/g, " ");
    if (!raw) continue;

    const key = normalise(raw);
    if (!key || key === skip || seen.has(key)) continue;

    seen.add(key);
    out.push(raw);
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Whether what somebody has typed is one of the suggestions already.
 *
 * Used to show a suggestion as chosen rather than as something still to
 * choose. Matched loosely, because "front yard" and "Front Yard " are the
 * same place and highlighting neither of them would be a lie.
 */
export function matchesSuggestion(typed: string, suggestion: string): boolean {
  const a = normalise(typed);
  return a.length > 0 && a === normalise(suggestion);
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
