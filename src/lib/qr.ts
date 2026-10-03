import QRCode from "qrcode";

/**
 * How much of the code can be lost and still read.
 *
 * "H" recovers about thirty per cent and is right for a sticker living on a
 * toolbox in a yard, where a scuffed corner is a certainty. It also makes the
 * code denser -- the same address needs a 37x37 grid at H against 29x29 at M --
 * and density is the enemy when the square is small, because what matters to a
 * phone camera is the size of one module, not the size of the whole code.
 *
 * So paper that lives in a folder gets "M": fewer, bigger modules in the same
 * space, which is the trade that actually makes a small printed code scan.
 */
export type QrRobustness = "L" | "M" | "Q" | "H";

/**
 * A QR code as an inline SVG.
 *
 * Made on the server and dropped straight into the page, so a label sheet is
 * just HTML — nothing to download, nothing to load, and it prints from a
 * phone the same as it prints from a laptop.
 *
 * `shape-rendering="crispEdges"` matters more than it looks: without it the
 * renderer anti-aliases every module edge, and at printed sizes that turns a
 * grid of black and white squares into a uniform grey smudge no camera will
 * read. The quiet zone is two modules rather than one for the same reason --
 * a code butted against a border is a code that fails to acquire.
 */
export async function qrSvg(
  text: string,
  size = 128,
  robustness: QrRobustness = "H"
): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: robustness,
    margin: 2,
    width: size,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return svg.replace("<svg", '<svg shape-rendering="crispEdges"');
}
