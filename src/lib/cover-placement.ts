/**
 * Which part of a photograph ends up in the frame.
 *
 * A post is a fixed shape and a phone photograph is not, so one of them has
 * to give. Cropping from the centre is the right default and the wrong answer
 * often enough to matter: the garden is at the bottom of the shot, or the
 * house is off to one side, and the centre of the picture is a lawn.
 *
 * So the crop can be nudged. This works out where the photograph sits once it
 * has been.
 */

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How much of the photograph hangs outside the frame, in each direction.
 *
 * Zero on one axis almost always: a photograph scaled to cover a box matches
 * it exactly on the tighter axis and overflows on the other. That is the axis
 * worth offering a control for.
 */
export interface Slack {
  x: number;
  y: number;
}

export function coverSlack(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number
): Slack {
  const scale = coverScaleFor(imageWidth, imageHeight, boxWidth, boxHeight);
  return {
    x: Math.max(0, imageWidth * scale - boxWidth),
    y: Math.max(0, imageHeight * scale - boxHeight),
  };
}

function coverScaleFor(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 1;
  return Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
}

/**
 * Where to draw the photograph so it fills the box.
 *
 * The offsets run -1 to 1 on each axis: -1 pins the top or left edge of the
 * photograph to the box, 1 pins the bottom or right, 0 centres it. Anything
 * outside that is clamped, because there is no such thing as dragging past
 * the edge of the picture — doing so would put empty frame in the post.
 */
export function coverPlacement(
  imageWidth: number,
  imageHeight: number,
  box: Placement,
  offsetX = 0,
  offsetY = 0
): Placement {
  const scale = coverScaleFor(imageWidth, imageHeight, box.width, box.height);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  const slackX = Math.max(0, width - box.width);
  const slackY = Math.max(0, height - box.height);

  return {
    width,
    height,
    x: box.x - (slackX / 2) * (1 + clamp(offsetX)),
    y: box.y - (slackY / 2) * (1 + clamp(offsetY)),
  };
}

export function clamp(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(-1, Math.min(1, offset));
}

/**
 * How far a drag of so many pixels moves the offset.
 *
 * A drag has to feel like moving the photograph, so a hundred pixels of
 * finger should be a hundred pixels of picture — which means the conversion
 * depends on how much slack there is, not on a fixed sensitivity.
 */
export function offsetDelta(pixels: number, slack: number): number {
  if (slack <= 0) return 0;
  return (-2 * pixels) / slack;
}
