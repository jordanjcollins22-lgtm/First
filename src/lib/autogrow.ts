/**
 * How tall a message box should be for what has been typed in it.
 *
 * The composer was a single-line bar that scrolled: past about a dozen words
 * you were writing into a slot that showed the last line only, with no way to
 * read back what you had already written before sending it. So it grows with
 * the message instead.
 *
 * It cannot grow forever — on a phone a long message would push the thread
 * off the screen entirely — so past a ceiling it scrolls, which is the old
 * behaviour but only once the box is already big.
 */

export interface GrowInput {
  /** What the browser says the content needs, in pixels. */
  scrollHeight: number;
  /** Never shorter than this — the resting size of an empty box. */
  min: number;
  /** Never taller than this. */
  max: number;
}

export interface GrowResult {
  height: number;
  /** True once the content no longer fits, so the box takes over scrolling. */
  scrollable: boolean;
}

export function growHeight({ scrollHeight, min, max }: GrowInput): GrowResult {
  const safeMax = Math.max(min, max);
  const wanted = Math.max(min, Math.ceil(scrollHeight));
  return { height: Math.min(wanted, safeMax), scrollable: wanted > safeMax };
}

/** A sensible ceiling for a phone: tall enough to read a real paragraph back,
 * short enough that the conversation above it is still on screen. */
export const COMPOSER_MAX_HEIGHT = 200;
