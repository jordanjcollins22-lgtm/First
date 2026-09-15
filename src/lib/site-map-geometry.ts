/**
 * Drawing a saved site map at the size it was saved at.
 *
 * The evaluation board works out a scale against the photo's own pixels and
 * stores it. The proposal and the crew sheet then draw the photo at
 * `naturalWidth * scale` inside a fixed viewBox. That multiplication is only
 * correct while the photo being measured is the same photo the scale was
 * worked out against.
 *
 * It stopped being, for a while: the site map was fetched as a resized copy
 * to make a sent proposal load faster, which halved the natural width and so
 * halved the drawn photo, leaving the map at the wrong zoom with the zones no
 * longer over the ground they were drawn around. On every load, because none
 * of it is stateful, and locking the board did not help -- the saved numbers
 * were right and the reading of them was wrong.
 *
 * The arithmetic lives here so there is somewhere to say that, and a test to
 * hold it.
 */

export interface StoredTransform {
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface DrawnSize {
  width: number;
  height: number;
}

/** The size to draw a site map photo at, from the photo that actually loaded. */
export function drawnSize(
  natural: { w: number; h: number },
  transform: StoredTransform
): DrawnSize {
  return { width: natural.w * transform.scale, height: natural.h * transform.scale };
}

/**
 * Whether a photo is the one this transform was saved against.
 *
 * A saved site map covers its board -- that is what the evaluation board
 * guarantees before it lets a design be saved. A photo that does not cover is
 * therefore not the photo the numbers describe, which in practice means a
 * resized copy was fetched instead of the original.
 *
 * Not a guess about image quality: it is the one check that catches the
 * mistake this file exists to document, and it costs an inequality.
 */
export function looksResized(
  natural: { w: number; h: number },
  transform: StoredTransform
): boolean {
  const drawn = drawnSize(natural, transform);
  // A little slack, because a saved design can sit exactly on the floor and
  // floating point should not turn that into an alarm.
  const slack = 0.99;
  return (
    drawn.width < transform.canvasWidth * slack || drawn.height < transform.canvasHeight * slack
  );
}
