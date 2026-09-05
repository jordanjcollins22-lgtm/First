import QRCode from "qrcode";

/**
 * A QR code as an inline SVG.
 *
 * Made on the server and dropped straight into the page, so a label sheet is
 * just HTML — nothing to download, nothing to load, and it prints from a
 * phone the same as it prints from a laptop.
 *
 * Error correction is set high on purpose. These stickers live on toolboxes
 * and shelves in a yard; a scuffed corner should still scan.
 */
export async function qrSvg(text: string, size = 128): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 1,
    width: size,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
