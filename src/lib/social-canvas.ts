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

export interface RenderOptions {
  beforeUrl: string;
  afterUrl: string;
  /** Optional logo drawn over the seam instead of the wordmark. */
  logoUrl?: string | null;
  /** Set false for a job where the rating badge would be a distraction. */
  showRating?: boolean;
  rating?: string;
}

/**
 * Draws the pair and hands back a PNG.
 *
 * Both photographs are cover-cropped: a post is a fixed shape and a phone
 * photograph is not, and letterboxing a customer's garden inside grey bars
 * looks like a mistake.
 */
export async function renderBeforeAfter(options: RenderOptions): Promise<Blob> {
  const [before, after, logo] = await Promise.all([
    loadImage(options.beforeUrl),
    loadImage(options.afterUrl),
    options.logoUrl ? loadImage(options.logoUrl).catch(() => null) : Promise.resolve(null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser will not give us a canvas to draw on.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawCover(ctx, before, 0, 0, CANVAS_WIDTH, BAND_TOP);
  drawCover(ctx, after, 0, BAND_BOTTOM, CANVAS_WIDTH, CANVAS_HEIGHT - BAND_BOTTOM);

  ctx.fillStyle = GREEN;
  ctx.fillRect(0, BAND_TOP, CANVAS_WIDTH, BAND_HEIGHT);

  drawChip(ctx, "BEFORE", 62, 34, CHIP_GREY);
  drawChip(ctx, "AFTER", 62, BAND_BOTTOM + 34, CHIP_GREEN);

  if (options.showRating !== false) {
    drawGoogleBadge(ctx, CANVAS_WIDTH - 62 - 340, 34, 340, 76, options.rating ?? "5.0");
  }

  drawWatermark(ctx, logo);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't turn the canvas into a file."))),
      "image/png"
    );
  });
}

/**
 * Fills the box, keeping the photograph's shape.
 *
 * Whatever hangs over the edge is cut. A garden filling the frame beats a
 * garden centred in grey.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);

  drawGoogleG(ctx, x + 22, y + height / 2, 22);

  ctx.fillStyle = "#5f6368";
  ctx.font = "600 24px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Google Rating", x + 58, y + 24);

  ctx.fillStyle = "#3c4043";
  ctx.font = "700 30px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(rating, x + 58, y + 54);

  drawStars(ctx, x + 108, y + 54, 22);
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
 * The mark over the seam.
 *
 * Sits across the join because that is the one place on the square that is
 * ours rather than the customer's garden, and because a watermark somebody
 * can crop off is not a watermark.
 */
function drawWatermark(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null) {
  ctx.save();
  ctx.globalAlpha = 0.28;

  if (logo) {
    const width = 420;
    const height = (logo.height / logo.width) * width;
    ctx.drawImage(logo, (CANVAS_WIDTH - width) / 2, BAND_TOP + BAND_HEIGHT / 2 - height / 2, width, height);
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 200px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText("JS", CANVAS_WIDTH / 2, BAND_TOP - 20);

    ctx.font = "700 54px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText("LANDSCAPING", CANVAS_WIDTH / 2, BAND_BOTTOM + 62);
  }

  ctx.restore();
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
