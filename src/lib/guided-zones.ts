/**
 * One area at a time.
 *
 * A crew member on site is shown where to start, what to do there, and
 * the evaluation's photo of it. When that area is done they take an
 * after photo from the same angle, and only then does the next area
 * appear. The truth is the photos: an area is done when it has an after
 * photo, so a phone that dies half way picks up at the right area.
 */

export interface GuidedZoneRef {
  id: string;
  name: string;
}

export interface GuidedProgress {
  /** Zone ids with an after photo, in sheet order. */
  done: string[];
  /** The area to work on now: the first without an after photo. Null when all are done. */
  current: GuidedZoneRef | null;
  /** 1-based place of the current area, for "Area 2 of 4". */
  position: number;
  total: number;
}

export function zoneProgress(zones: readonly GuidedZoneRef[], photos: readonly { zoneId: string | null; kind: string }[]): GuidedProgress {
  const withAfter = new Set(photos.filter((p) => p.kind === "after" && p.zoneId).map((p) => p.zoneId as string));
  const done = zones.filter((z) => withAfter.has(z.id)).map((z) => z.id);
  const current = zones.find((z) => !withAfter.has(z.id)) ?? null;
  const position = current ? zones.findIndex((z) => z.id === current.id) + 1 : zones.length;
  return { done, current, position, total: zones.length };
}

/** What to say about the after photo, given what the evaluation left to match. */
export function angleLine(evaluationPhotos: number): string {
  if (evaluationPhotos === 0) return "Take an after photo that shows the whole area.";
  if (evaluationPhotos === 1) return "Stand where the evaluation photo was taken and match its angle.";
  return "Match the angle of one of the evaluation photos above, the first one if you can.";
}
