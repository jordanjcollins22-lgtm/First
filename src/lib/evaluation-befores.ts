/**
 * The evaluation's zone photos are the "before".
 *
 * Somebody already stood in that garden and photographed it before a single
 * thing was touched. Asking the crew to shoot a second "before" on the day is
 * asking for a photograph of work that has already started — and when they
 * forget, the job produces no before-and-after at all despite having a folder
 * of pictures of exactly that.
 *
 * So the ones taken at the evaluation are adopted as the befores. This works
 * out which, and where each one lands.
 */

export interface ZoneLike {
  id: string;
  name: string;
  service: { photos?: string[] | null } | null;
}

export interface BeforeCandidate {
  /** Where it is now, in the canvas bucket. */
  sourcePath: string;
  /** Where it goes, in the job photos bucket. */
  destPath: string;
  zoneId: string;
  zoneName: string;
}

/**
 * Where a zone photo lands once it is a before.
 *
 * Worked out from the source rather than made up fresh, so running this twice
 * produces the same path twice and the second run has nothing to do. An
 * evaluation submitted, corrected and submitted again must not end up with
 * every photo in there two or three times.
 */
export function destPathFor(jobId: string, sourcePath: string): string {
  const name = sourcePath.split("/").pop() ?? sourcePath;
  return `${jobId}/from-evaluation/${name}`;
}

/**
 * Every zone photo that should become a before.
 *
 * Only zones with a service on them: a shape somebody drew and never said
 * what it was for is a draft, and its photographs are not a record of
 * anything yet.
 *
 * The same photo attached to two zones is taken once — it is one picture of
 * one place, whatever it has been filed under.
 */
export function beforesFromZones(jobId: string, zones: ZoneLike[]): BeforeCandidate[] {
  const seen = new Set<string>();
  const candidates: BeforeCandidate[] = [];

  for (const zone of zones) {
    if (!zone.service) continue;
    for (const sourcePath of zone.service.photos ?? []) {
      if (!sourcePath || seen.has(sourcePath)) continue;
      seen.add(sourcePath);
      candidates.push({
        sourcePath,
        destPath: destPathFor(jobId, sourcePath),
        zoneId: zone.id,
        zoneName: zone.name,
      });
    }
  }

  return candidates;
}

/**
 * The ones not already adopted.
 *
 * Compared on the destination path, which is the thing the photos table
 * actually holds — comparing on the source would mean trusting that nothing
 * ever moved.
 */
export function notYetAdopted(
  candidates: BeforeCandidate[],
  existingPaths: Iterable<string>
): BeforeCandidate[] {
  const existing = new Set(existingPaths);
  return candidates.filter((candidate) => !existing.has(candidate.destPath));
}
