/**
 * Whether two fetches of the same view came back with the same photo.
 *
 * There is no way to ask Mapbox when a satellite image was taken — the static
 * images API serves pixels and says nothing about when the plane or the
 * satellite went over. So "is there newer imagery" cannot be answered by
 * asking. It can only be answered by fetching the same view again and seeing
 * whether what comes back is different.
 *
 * That is a narrower claim than "this is newer", and the wording on screen
 * has to match it: the imagery changed, not the imagery is from Tuesday.
 */

/** Sizes first: two different photos are almost never the same length, and
 * comparing lengths costs nothing. */
export function bytesDiffer(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export type ImageryVerdict = "changed" | "same" | "unknown";

/**
 * What to tell somebody who pressed check.
 *
 * "unknown" is a real answer and gets said out loud rather than being
 * reported as "same". A comparison that could not be made is not evidence
 * that nothing changed, and quietly saying it is would have somebody trust a
 * two-year-old photo of a garden that has been relandscaped since.
 */
export function describeImagery(verdict: ImageryVerdict): string {
  switch (verdict) {
    case "changed":
      return "Mapbox has different imagery for this address now. The board has been updated to it.";
    case "same":
      return "No change. This is the most recent imagery Mapbox has for this address.";
    case "unknown":
      return "Couldn't compare against what you have. Nothing on the board was changed.";
  }
}

/**
 * Compares a freshly fetched photo against the one on the board.
 *
 * Both are read fully before comparing rather than streamed: these are a
 * couple of megabytes, they are already in memory, and a partial comparison
 * that answers "same" early is the wrong kind of fast.
 */
export async function compareImagery(current: Blob, fetched: Blob): Promise<ImageryVerdict> {
  try {
    const [a, b] = await Promise.all([current.arrayBuffer(), fetched.arrayBuffer()]);
    return bytesDiffer(new Uint8Array(a), new Uint8Array(b)) ? "changed" : "same";
  } catch {
    return "unknown";
  }
}
