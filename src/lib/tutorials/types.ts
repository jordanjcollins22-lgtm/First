/**
 * A first-open tutorial: a few short steps, each pointing at one thing on
 * the screen. If a role can't be taught in a handful of steps, the role's
 * screens are too complicated, which is the point of keeping them short.
 */
export interface TourStep {
  title: string;
  body: string;
  /** The data-tour value of what to point at. Left out, the step sits in the middle. */
  target?: string;
}

export interface Tour {
  /** Bump the version in the id when the steps change, so everyone sees it again once. */
  id: string;
  title: string;
  steps: TourStep[];
}

/** At most this many steps: a tutorial longer than this means the role is too complex. */
export const MAX_TOUR_STEPS = 7;
