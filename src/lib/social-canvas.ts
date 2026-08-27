/**
 * Drawing the before-and-after square.
 *
 * Done in the browser on a canvas rather than on a server with an image
 * library: the photographs are already loaded on the page somebody is looking
 * at, the person approving can see exactly what will go out before it goes
 * out, and there is no second copy of the layout to keep in step.
 *
 * The measurements are the ones in the artwork we already post, so a post
 * made here is indistinguishable from one made by hand.
 */

import { coverPlacement } from "@/lib/cover-placement";

/** 4:5. The tallest a feed will show without cropping it for you. */
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1350;

/** The green band across the middle, and where it sits. */
const BAND_TOP = 648;
const BAND_HEIGHT = 48;
const BAND_BOTTOM = BAND_TOP + BAND_HEIGHT;

const GREEN = "#2f8f1f";
const CHIP_GREEN = "#7ab648";
const CHIP_GREY = "rgba(150, 150, 150, 0.88)";


/** How far the crop has been nudged, -1 to 1 on each axis. */
export interface Nudge {
  x: number;
  y: number;
}

export const CENTRED: Nudge = { x: 0, y: 0 };

export interface CompositeOptions {
  /** Set false for a job where the rating badge would be a distraction. */
  showRating?: boolean;
  rating?: string;
  /** Which part of each photograph ends up in its half. */
  beforeNudge?: Nudge;
  afterNudge?: Nudge;
}

export interface RenderOptions extends CompositeOptions {
  beforeUrl: string;
  afterUrl: string;
}

/** The two halves, so a caller can work out what it is dragging. */
export const BEFORE_BOX = { x: 0, y: 0, width: CANVAS_WIDTH, height: BAND_TOP };
export const AFTER_BOX = {
  x: 0,
  y: BAND_BOTTOM,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT - BAND_BOTTOM,
};

/** Both photographs, loaded once so a drag can redraw without refetching. */
export async function loadPair(
  beforeUrl: string,
  afterUrl: string
): Promise<{ before: HTMLImageElement; after: HTMLImageElement }> {
  const [before, after] = await Promise.all([loadImage(beforeUrl), loadImage(afterUrl)]);
  return { before, after };
}

/**
 * Draws the whole square onto a context somebody else owns.
 *
 * Split out from the file-making so a preview can redraw on every frame of a
 * drag without producing a file each time — and so the file, when it is
 * finally made, is made by exactly this code and not a second copy of it.
 */
export function drawComposite(
  ctx: CanvasRenderingContext2D,
  images: { before: HTMLImageElement; after: HTMLImageElement },
  options: CompositeOptions = {}
): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawCover(ctx, images.before, BEFORE_BOX, options.beforeNudge ?? CENTRED);
  drawCover(ctx, images.after, AFTER_BOX, options.afterNudge ?? CENTRED);

  ctx.fillStyle = GREEN;
  ctx.fillRect(0, BAND_TOP, CANVAS_WIDTH, BAND_HEIGHT);

  drawChip(ctx, "BEFORE", 62, 34, CHIP_GREY);
  drawChip(ctx, "AFTER", 62, BAND_BOTTOM + 34, CHIP_GREEN);

  if (options.showRating !== false) {
    // Flush to the top and right edges. Floated off them it read as a
    // sticker somebody dropped on the photograph; against the corner it
    // reads as part of the card.
    const badgeWidth = 340;
    const badgeHeight = 86;
    drawGoogleBadge(ctx, CANVAS_WIDTH - badgeWidth, 0, badgeWidth, badgeHeight, options.rating ?? "5.0");
  }
}

/**
 * Draws the pair and hands back a PNG.
 *
 * Both photographs are cover-cropped: a post is a fixed shape and a phone
 * photograph is not, and letterboxing a customer's garden inside grey bars
 * looks like a mistake.
 */
export async function renderBeforeAfter(options: RenderOptions): Promise<Blob> {
  const images = await loadPair(options.beforeUrl, options.afterUrl);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser will not give us a canvas to draw on.");

  drawComposite(ctx, images, options);

  return await toBlob(canvas);
}

/** A canvas as a PNG. The one place the file actually gets made. */
export function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't turn the canvas into a file."))),
      "image/png"
    );
  });
}

/**
 * Fills the box, keeping the photograph's shape.
 *
 * Whatever hangs over the edge is cut. Which part gets cut is the nudge's
 * business — a garden at the bottom of the shot should not be lost to a crop
 * that always takes the middle.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
  nudge: Nudge
) {
  const placed = coverPlacement(image.width, image.height, box, nudge.x, nudge.y);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.drawImage(image, placed.x, placed.y, placed.width, placed.height);
  ctx.restore();
}

/** The BEFORE / AFTER flag in the corner. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  background: string
) {
  const height = 72;
  const padding = 34;

  ctx.font = "700 42px system-ui, -apple-system, 'Segoe UI', sans-serif";
  const width = ctx.measureText(text).width + padding * 2;

  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x + padding, y + height / 2 + 2);
}

/**
 * The Google rating badge.
 *
 * Ours, on our own work — the same badge already on the flyers. Drawn rather
 * than fetched so a post can be made with no network beyond the two
 * photographs.
 */
function drawGoogleBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rating: string
) {
  // Square against the two edges it touches, rounded on the one corner that
  // sits over the photograph — the shape of something attached rather than
  // something laid on top.
  const radius = 22;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  const centreY = y + height / 2;
  drawGoogleG(ctx, x + 40, centreY, 22);

  ctx.fillStyle = "#5f6368";
  ctx.font = "600 24px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Google Rating", x + 76, centreY - 14);

  ctx.fillStyle = "#3c4043";
  ctx.font = "700 30px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(rating, x + 76, centreY + 18);

  drawStars(ctx, x + 126, centreY + 18, 22);
}

/** Four arcs and a bar — the mark, near enough at this size. */
function drawGoogleG(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const segments: [number, number, string][] = [
    [-0.35, 1.05, "#4285f4"],
    [1.05, 2.6, "#34a853"],
    [2.6, 4.0, "#fbbc05"],
    [4.0, 5.6, "#ea4335"],
  ];

  ctx.save();
  ctx.lineWidth = r * 0.42;
  for (const [start, end, color] of segments) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.arc(cx, cy, r * 0.78, start, end);
    ctx.stroke();
  }
  // The crossbar of the G.
  ctx.fillStyle = "#4285f4";
  ctx.fillRect(cx, cy - r * 0.12, r * 0.85, r * 0.4);
  ctx.restore();
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.fillStyle = "#fbbc05";
  for (let i = 0; i < 5; i++) {
    drawStar(ctx, x + i * (size + 6) + size / 2, y, size / 2);
  }
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath();
  for (let point = 0; point < 10; point++) {
    const r = point % 2 === 0 ? radius : radius * 0.45;
    const angle = (Math.PI / 5) * point - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Loads a photograph so it can be drawn.
 *
 * crossOrigin is set because the job photos come from signed storage URLs on
 * another origin, and without it the canvas is tainted and refuses to hand
 * back a file at the end.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load that photo."));
    image.src = url;
  });
}
