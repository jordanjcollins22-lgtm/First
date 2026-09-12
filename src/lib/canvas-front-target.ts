/**
 * The "this way round" marker on the evaluation board.
 *
 * Drawn on the canvas rather than beside it, because the thing it is talking
 * about is on the canvas: a note under the picture saying "point the front
 * down" is a note about a picture, and an arrow on the picture is an
 * instruction about the house.
 *
 * Its own module so the thing that gets checked is the thing that ships.
 */
export function drawFrontTarget(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const cx = width / 2;
  const baseY = height - 16;
  const blue = "rgba(37, 99, 235, 0.95)";

  ctx.save();

  // A lane down the middle, so "centred" is visible as well as "which way".
  ctx.strokeStyle = blue;
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 150);
  ctx.lineTo(cx, baseY - 46);
  ctx.stroke();
  ctx.setLineDash([]);

  // The arrowhead, pointing at the bottom edge.
  ctx.fillStyle = blue;
  ctx.beginPath();
  ctx.moveTo(cx - 26, baseY - 52);
  ctx.lineTo(cx + 26, baseY - 52);
  ctx.lineTo(cx, baseY - 14);
  ctx.closePath();
  ctx.fill();

  const label = "FRONT OF HOUSE POINTS HERE";
  ctx.font = "700 20px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxWidth = ctx.measureText(label).width + 28;

  ctx.fillStyle = blue;
  ctx.fillRect(cx - boxWidth / 2, baseY - 196, boxWidth, 34);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, cx, baseY - 178);

  ctx.restore();
}
