/**
 * Fitting as many cutouts on a sheet as will still come apart with a blade.
 *
 * One shape per sheet is the obvious way to print cutouts and it wastes most
 * of the paper: a sign made of fourteen phrases came to fourteen sheets, and
 * eleven of them were a strip of words across the top and eight inches of
 * white below it.
 *
 * Packed so that every cut is a straight line all the way across whatever is
 * left. That is not a compromise for the sake of a simpler algorithm; it is
 * the only kind of packing a person can actually cut. The sheet comes apart in
 * passes — one straight cut divides it in two, then each half divides again —
 * so a paper trimmer does the whole page. A tighter packing that interlocked
 * the shapes would fit one more phrase and need scissors and a steady hand for
 * every one of them.
 *
 * Kept true by construction: a piece is placed in the top left of a free
 * rectangle, and what is left is split into two rectangles by a single line
 * running the full length of that space. Nothing is ever placed in a way that
 * would need an L-shaped cut.
 *
 * The gutter is what makes it real. Two shapes sharing an edge cannot be cut
 * apart without cutting one of them, so everything gets a lane between it and
 * its neighbour, wide enough for a blade and for the number printed beside it.
 */

export interface Packable {
  width: number;
  height: number;
}

export interface Placement<T> {
  item: T;
  /** Top left corner, measured from the top left of the sheet's usable area. */
  x: number;
  y: number;
}

export interface PackedSheet<T> {
  placements: Placement<T>[];
}

/** Somewhere a piece could still go. Always a rectangle, never an L. */
interface Free {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sheet<T> {
  placements: Placement<T>[];
  free: Free[];
}

const EPS = 1e-9;

/**
 * Lay items out over as few sheets as this will manage.
 *
 * Biggest first, because a large piece placed late has nowhere to go and opens
 * a sheet of its own. Then best fit across every sheet already started, not
 * just the newest — a narrow phrase often slides into a gap left on the first
 * sheet long after that sheet was filled.
 *
 * Anything too big for an empty sheet gets one to itself rather than being
 * dropped. A cutout that cannot be printed is a missing word on the sign, and
 * a page that is too big to cut is a problem somebody can see and deal with.
 */
export function packSheets<T extends Packable>(
  items: T[],
  sheet: { width: number; height: number },
  gutter: number
): PackedSheet<T>[] {
  const sheets: Sheet<T>[] = [];

  // Ties broken all the way down, so the same input always gives the same
  // sheets. A packer that shuffles between runs makes a reprint of page two
  // land on different pieces.
  const order = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        b.item.height * b.item.width - a.item.height * a.item.width ||
        b.item.height - a.item.height ||
        b.item.width - a.item.width ||
        a.index - b.index
    );

  for (const { item } of order) {
    if (place(sheets, item, gutter)) continue;

    const fresh: Sheet<T> = {
      placements: [],
      free: [{ x: 0, y: 0, width: sheet.width, height: sheet.height }],
    };
    sheets.push(fresh);

    // On a brand-new sheet this can still fail, for a piece bigger than the
    // paper. It gets the sheet anyway: a missing word is worse than a page
    // somebody has to look at.
    if (!place([fresh], item, gutter)) {
      fresh.placements.push({ item, x: 0, y: 0 });
      fresh.free = [];
    }
  }

  return sheets.map((s) => ({ placements: s.placements }));
}

/**
 * Put one item in the tightest gap that will take it.
 *
 * Tightest by the shorter of the two leftovers, which is the heuristic that
 * stops a small piece being dropped into the middle of a large empty space and
 * cutting it into two pieces of scrap.
 */
function place<T extends Packable>(sheets: Sheet<T>[], item: T, gutter: number): boolean {
  let best: { sheet: Sheet<T>; free: Free; waste: number } | null = null;

  for (const s of sheets) {
    for (const free of s.free) {
      if (item.width > free.width + EPS || item.height > free.height + EPS) continue;
      const waste = Math.min(free.width - item.width, free.height - item.height);
      if (!best || waste < best.waste - EPS) best = { sheet: s, free, waste };
    }
  }

  if (!best) return false;

  const { sheet: s, free } = best;
  s.placements.push({ item, x: free.x, y: free.y });
  s.free = s.free.filter((f) => f !== free);
  s.free.push(...split(free, item, gutter));
  return true;
}

/**
 * What is left of a gap once a piece is in the corner of it.
 *
 * Two rectangles, made by one straight line across the whole gap. Which
 * direction that line runs is chosen to leave the larger of the two pieces
 * whole, since a long thin offcut is worth less than a squarer one.
 *
 * The gutter is taken out of the space to the right and below, so nothing
 * lands against a neighbour. It is clamped to the gap: a strip exactly as wide
 * as the sheet reserves no lane beside it, because there is no beside.
 */
function split(free: Free, item: Packable, gutter: number): Free[] {
  const usedWidth = Math.min(free.width, item.width + gutter);
  const usedHeight = Math.min(free.height, item.height + gutter);
  const rightWidth = free.width - usedWidth;
  const belowHeight = free.height - usedHeight;

  const parts: Free[] =
    rightWidth >= belowHeight
      ? [
          // The line runs top to bottom: everything to the right stays whole.
          { x: free.x + usedWidth, y: free.y, width: rightWidth, height: free.height },
          { x: free.x, y: free.y + usedHeight, width: usedWidth, height: belowHeight },
        ]
      : [
          // The line runs left to right: everything below stays whole.
          { x: free.x, y: free.y + usedHeight, width: free.width, height: belowHeight },
          { x: free.x + usedWidth, y: free.y, width: rightWidth, height: usedHeight },
        ];

  return parts.filter((p) => p.width > EPS && p.height > EPS);
}

/** Whether two placements would be impossible to cut apart. */
export function collide<T extends Packable>(a: Placement<T>, b: Placement<T>, gutter: number): boolean {
  const overlapsX = a.x + a.item.width + gutter > b.x + EPS && b.x + b.item.width + gutter > a.x + EPS;
  const overlapsY = a.y + a.item.height + gutter > b.y + EPS && b.y + b.item.height + gutter > a.y + EPS;
  return overlapsX && overlapsY;
}
