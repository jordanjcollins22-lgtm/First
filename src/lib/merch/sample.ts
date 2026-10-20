import { renderBarcode } from "./barcode";
import { SAMPLE_BARCODE_VALUES } from "./formats";
import { renderDesign, sampleFieldValues } from "./template";
import type { MerchProduct } from "@/types/domain";

/** The product's design with a sample barcode and placeholder text, or null if it can't render. */
export function renderSamplePreview(product: Pick<MerchProduct, "design_svg" | "barcode_format">) {
  const barcode = renderBarcode(product.barcode_format, SAMPLE_BARCODE_VALUES[product.barcode_format]);
  if (!barcode.ok) return null;
  try {
    return renderDesign(product.design_svg, {
      barcodeSvg: barcode.svg,
      values: sampleFieldValues(product.design_svg),
    });
  } catch {
    return null;
  }
}
