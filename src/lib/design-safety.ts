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
