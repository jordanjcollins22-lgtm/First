import { renderBarcode } from "./barcode";
import { SAMPLE_AFFILIATE_CODE } from "./affiliate";
import { SAMPLE_BARCODE_VALUES } from "./formats";
import { renderDesign } from "./template";
import type { MerchProduct } from "@/types/domain";

/** The product's design with a sample barcode and placeholder text, or null if it can't render. */
export function renderSamplePreview(
  product: Pick<MerchProduct, "design_svg" | "barcode_format" | "barcode_source">
) {
  const barcode =
    product.barcode_source === "affiliate"
      ? renderBarcode("qrcode", `https://example.com/r/${SAMPLE_AFFILIATE_CODE}`)
      : renderBarcode(product.barcode_format, SAMPLE_BARCODE_VALUES[product.barcode_format]);
  if (!barcode.ok) return null;
  try {
    return renderDesign(product.design_svg, { barcodeSvg: barcode.svg });
  } catch {
    return null;
  }
}
