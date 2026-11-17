/**
 * Refusing to save nothing over something.
 *
 * The evaluation board autosaves whatever is in its state a moment after any
 * change. That is right nearly always, and catastrophic in one case: if the
 * board ends up mounted with empty state over a job that has a real design --
 * a failed load, a race, a bug nobody has found yet -- the next keystroke
 * writes that emptiness over the work.
 *
 * It happened once, to a twenty-three zone commercial site, and the only
 * reason it was recoverable is that a proposal had been generated from it
 * first. That is luck, not a design.
 *
 * So a save that carries nothing at all is refused when the stored design has
 * something. The check is deliberately narrow -- nothing at all, not merely
 * fewer zones -- because a person deleting one zone is ordinary and a person
 * deleting a whole design in one go is not.
 *
 * The trade is real and worth naming: somebody who genuinely means to clear a
 * design completely will find it back after a reload. That is a visible
 * annoyance they can act on, and it is the right side of a trade against
 * silently losing an afternoon of drawing.
 */

export interface DesignShape {
  imagePath: string | null;
  zoneCount: number;
  propertyLinePoints: number;
  houseOutlinePoints: number;
  markCount: number;
}

/** Nothing on the board at all: no photo, no shapes, no notes. */
export function isEmptyDesign(design: DesignShape): boolean {
  return (
    !design.imagePath &&
    design.zoneCount === 0 &&
    design.propertyLinePoints === 0 &&
    design.houseOutlinePoints === 0 &&
    design.markCount === 0
  );
}

/**
 * Whether writing `incoming` would replace real work with nothing.
 *
 * False when there is no stored design, because the first save of a new job is
 * legitimately empty and refusing it would stop a board ever starting.
 */
export function wouldBlank(incoming: DesignShape, stored: DesignShape | null): boolean {
  if (!stored) return false;
  return isEmptyDesign(incoming) && !isEmptyDesign(stored);
}

/* ------------------------------------- what a half-loaded board must not touch */

type Point = { x: number; y: number };

/** The parts of a save that belong to the photo, and the lines drawn on it. */
export interface SavedGround {
  imagePath: string | null;
  imageX: number;
  imageY: number;
  imageScale: number;
  imageRotation: number;
  imageRealWidthFeet: number | null;
  imageBearing: number;
  imageGeo: unknown;
  imageUploaded: boolean;
  propertyLine: Point[];
  houseOutline: Point[];
}

/**
 * What to write for the photo and the lines on it, given what is stored.
 *
 * A board that has not finished loading the saved map still saves: its photo
 * is not on it yet, so it sends the photo's defaults (no turn, no zoom, no
 * record of where it was taken), and its property line and house can be
 * empty. Written over a real map, that turns the county line the wrong way
 * round and wipes the house, and nobody sees it until the next visit. It
 * happened on a walkthrough: an area added while the map was loading took
 * the line, the house and the photo's turn with it.
 *
 * So, while the photo stays the same one:
 * - a board without that photo on it does not change the photo's settings;
 * - an empty property line or house does not replace a drawn one;
 * - no record of where the photo was taken does not replace one.
 *
 * A new photo is a new path, and then everything is written as sent.
 */
export function keepSavedGround(incoming: SavedGround & { photoOnPath?: boolean }, stored: SavedGround | null): SavedGround {
  const { photoOnPath, ...sent } = incoming;
  if (!stored || !stored.imagePath || incoming.imagePath !== stored.imagePath) return sent;

  const out: SavedGround = { ...sent };
  if (photoOnPath === false) {
    out.imageX = stored.imageX;
    out.imageY = stored.imageY;
    out.imageScale = stored.imageScale;
    out.imageRotation = stored.imageRotation;
    out.imageRealWidthFeet = stored.imageRealWidthFeet;
    out.imageBearing = stored.imageBearing;
    out.imageGeo = stored.imageGeo;
    out.imageUploaded = stored.imageUploaded;
  }
  if (out.imageGeo == null && stored.imageGeo != null) {
    out.imageGeo = stored.imageGeo;
    out.imageBearing = stored.imageBearing;
  }
  if (out.propertyLine.length === 0 && stored.propertyLine.length > 0) out.propertyLine = stored.propertyLine;
  if (out.houseOutline.length === 0 && stored.houseOutline.length > 0) out.houseOutline = stored.houseOutline;
  return out;
}

/** Whether a save could lose something, so the stored map is worth reading first. */
export function couldLoseGround(incoming: SavedGround & { photoOnPath?: boolean }): boolean {
  if (!incoming.imagePath) return false;
  return incoming.photoOnPath === false || incoming.imageGeo == null || incoming.propertyLine.length === 0 || incoming.houseOutline.length === 0;
}
