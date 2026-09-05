/**
 * Notes pinned to a place on the picture.
 *
 * An evaluation already records what the work is and where the zones are. It
 * had nowhere to put the things that are neither — the broken sprinkler head,
 * the dog gate that has to stay shut, the bank too steep to mow. Those go in
 * somebody's memory and arrive on site as a surprise.
 *
 * A note on its own is a paragraph nobody reads. A note stuck to the spot it
 * is about is an instruction.
 */

export interface Point {
  x: number;
  y: number;
}

export interface CanvasMark extends Point {
  id: string;
  note: string;
  /** Who put it there, so a question about it has somebody to ask. */
  authorName: string | null;
  createdAt: string;
}

/** How close a tap has to land to count as hitting a pin. */
export const MARK_HIT_RADIUS = 18;

/**
 * Which pin a tap landed on.
 *
 * Newest first, so a pin dropped on top of an older one is the one you get
 * back — which is the one you were just looking at.
 */
export function markAt(
  marks: CanvasMark[],
  point: Point,
  radius: number = MARK_HIT_RADIUS
): CanvasMark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (Math.hypot(mark.x - point.x, mark.y - point.y) <= radius) return mark;
  }
  return null;
}

export function addMark(
  marks: CanvasMark[],
  point: Point,
  note: string,
  authorName: string | null,
  id: string,
  now: string = new Date().toISOString()
): CanvasMark[] {
  return [
    ...marks,
    { id, x: point.x, y: point.y, note: note.trim(), authorName, createdAt: now },
  ];
}

export function updateMark(marks: CanvasMark[], id: string, note: string): CanvasMark[] {
  return marks.map((mark) => (mark.id === id ? { ...mark, note: note.trim() } : mark));
}

export function moveMark(marks: CanvasMark[], id: string, point: Point): CanvasMark[] {
  return marks.map((mark) => (mark.id === id ? { ...mark, x: point.x, y: point.y } : mark));
}

export function removeMark(marks: CanvasMark[], id: string): CanvasMark[] {
  return marks.filter((mark) => mark.id !== id);
}

/**
 * A mark with nothing written on it is not a mark.
 *
 * Dropped rather than kept: an empty pin on a picture is a question the crew
 * cannot answer, and leaving it there is worse than never placing it.
 */
export function withoutEmpty(marks: CanvasMark[]): CanvasMark[] {
  return marks.filter((mark) => mark.note.trim().length > 0);
}

/** What a pin shows on the picture. The number, and nothing else. */
export function markNumber(marks: CanvasMark[], id: string): number {
  return marks.findIndex((mark) => mark.id === id) + 1;
}

/**
 * The notes as a list, in the order they are numbered on the picture.
 *
 * Same order in both places on purpose: a crew reading "3. gate stays shut"
 * has to be able to find pin 3 without hunting.
 */
export function markList(marks: CanvasMark[]): { number: number; note: string }[] {
  return withoutEmpty(marks).map((mark, index) => ({
    number: index + 1,
    note: mark.note,
  }));
}

/** A short line for anywhere that cannot show the picture. */
export function summariseMarks(marks: CanvasMark[], limit = 3): string | null {
  const notes = withoutEmpty(marks);
  if (notes.length === 0) return null;

  const shown = notes.slice(0, limit).map((mark) => mark.note);
  const rest = notes.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} (+${rest} more)` : shown.join("; ");
}
