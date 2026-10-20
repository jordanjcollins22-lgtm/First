"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { sendTextToMember } from "@/lib/check-ins/service";
import { isGhlConfigured, serverEnv } from "@/lib/env";
import { affiliateLink, SAMPLE_AFFILIATE_CODE } from "@/lib/merch/affiliate";
import { renderBarcode } from "@/lib/merch/barcode";
import { BARCODE_FORMATS } from "@/lib/merch/formats";
import { nextStatus, PAYMENT_OPTIONS } from "@/lib/merch/format";
import { renderDesign, templateFields, validateTemplate } from "@/lib/merch/template";
import { createClient } from "@/lib/supabase/server";
import type {
  BarcodeFormat,
  BarcodeSource,
  MerchOrderStatus,
  MerchPaymentStatus,
  MerchProduct,
  MerchShipTo,
  TeamMember,
} from "@/types/domain";

export interface ActionResult {
  error?: string;
}

export type PreviewResult = { svg: string; error?: undefined } | { svg?: undefined; error: string };

const MAX_DESIGN_BYTES = 2_000_000;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** APP_URL, or the current host if it isn't set (fine for testing, not for printing). */
async function appOrigin() {
  if (serverEnv.appUrl) return serverEnv.appUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function affiliateBarcodeValue(teamMemberId: string | undefined): Promise<string | null> {
  if (!teamMemberId) return affiliateLink(await appOrigin(), SAMPLE_AFFILIATE_CODE);
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("affiliate_code")
    .eq("id", teamMemberId)
    .maybeSingle();
  return data ? affiliateLink(await appOrigin(), data.affiliate_code) : null;
}

function buildPrintFile(
  designSvg: string,
  format: BarcodeFormat,
  barcodeValue: string,
  values: Record<string, string>
): PreviewResult {
  const problems = validateTemplate(designSvg);
  if (problems.length) return { error: problems.join(" ") };
  const barcode = renderBarcode(format, barcodeValue);
  if (!barcode.ok) return { error: barcode.error };
  return { svg: renderDesign(designSvg, { barcodeSvg: barcode.svg, values }) };
}

/**
 * Live preview for the design editor (raw SVG) and the order form (saved
 * product). For affiliate items the barcode comes from the team member, not
 * from `barcodeValue`.
 */
export async function previewMerchDesign(input: {
  productId?: string;
  designSvg?: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: BarcodeSource;
  barcodeValue?: string;
  teamMemberId?: string;
  values: Record<string, string>;
}): Promise<PreviewResult> {
  let design = input.designSvg ?? "";
  let format = input.barcodeFormat ?? "code128";
  let source = input.barcodeSource ?? "custom";
  if (input.productId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("merch_products")
      .select("design_svg, barcode_format, barcode_source")
      .eq("id", input.productId)
      .single();
    if (error) return { error: "That product no longer exists." };
    design = data.design_svg;
    format = data.barcode_format as BarcodeFormat;
    source = data.barcode_source as BarcodeSource;
  }
  if (design.length > MAX_DESIGN_BYTES) return { error: "Design file is too large (2 MB max)." };

  let barcodeValue = input.barcodeValue ?? "";
  if (source === "affiliate") {
    const link = await affiliateBarcodeValue(input.teamMemberId);
    if (!link) return { error: "That team member no longer exists." };
    barcodeValue = link;
    format = "qrcode";
  }
  return buildPrintFile(design, format, barcodeValue, input.values);
}

export async function createMerchProduct(formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };
  const designSvg = String(formData.get("design_svg") ?? "");
  if (designSvg.length > MAX_DESIGN_BYTES) return { error: "Design file is too large (2 MB max)." };
  const problems = validateTemplate(designSvg);
  if (problems.length) return { error: problems.join(" ") };
  const source: BarcodeSource = str(formData, "barcode_source") === "affiliate" ? "affiliate" : "custom";
  // Affiliate links are URLs, which only a QR code holds and phones scan reliably.
  const format = source === "affiliate" ? "qrcode" : (str(formData, "barcode_format") as BarcodeFormat);
  if (!BARCODE_FORMATS.some((f) => f.value === format)) return { error: "Pick a barcode type." };
  const price = Number.parseFloat(str(formData, "price") || "0");
  if (!Number.isFinite(price) || price < 0) return { error: "Enter a valid price." };

  const supabase = await createClient();
  const { error } = await supabase.from("merch_products").insert({
    name,
    description: str(formData, "description") || null,
    design_svg: designSvg,
    barcode_format: format,
    barcode_source: source,
    price_cents: Math.round(price * 100),
    vendor_name: str(formData, "vendor_name") || null,
    vendor_sku: str(formData, "vendor_sku") || null,
    print_specs: str(formData, "print_specs") || null,
  });
  if (error) throw error;

  revalidatePath("/admin/store");
  revalidatePath("/store");
  return {};
}

export async function setMerchProductActive(id: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("merch_products").update({ active }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/store");
  revalidatePath("/store");
}

export async function createMerchOrder(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const productId = str(formData, "product_id");
  const { data: productRow, error: productError } = await supabase
    .from("merch_products")
    .select("*")
    .eq("id", productId)
    .eq("active", true)
    .maybeSingle();
  if (productError) throw productError;
  if (!productRow) return { error: "That item isn't available anymore." };
  const product = productRow as unknown as MerchProduct;

  const teamMemberId = str(formData, "team_member_id");
  if (!teamMemberId) return { error: "Pick who this order is for." };
  const quantity = Math.floor(Number(str(formData, "quantity") || "1"));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
    return { error: "Quantity must be between 1 and 500." };
  }

  let barcodeValue = str(formData, "barcode_value");
  if (product.barcode_source === "affiliate") {
    const link = await affiliateBarcodeValue(teamMemberId);
    if (!link) return { error: "That team member no longer exists." };
    barcodeValue = link;
  }
  const values: Record<string, string> = {};
  for (const field of templateFields(product.design_svg)) {
    values[field.key] = str(formData, `field_${field.key}`);
  }

  const shipTo: MerchShipTo = {
    name: str(formData, "ship_name"),
    address1: str(formData, "ship_address1"),
    address2: str(formData, "ship_address2") || undefined,
    city: str(formData, "ship_city"),
    state: str(formData, "ship_state").toUpperCase(),
    zip: str(formData, "ship_zip"),
  };
  if (!shipTo.name || !shipTo.address1 || !shipTo.city || !shipTo.state || !shipTo.zip) {
    return { error: "Fill in the full shipping address." };
  }

  const printFile = buildPrintFile(product.design_svg, product.barcode_format, barcodeValue, values);
  if (printFile.error !== undefined) return { error: printFile.error };

  const { error } = await supabase.from("merch_orders").insert({
    product_id: product.id,
    team_member_id: teamMemberId,
    quantity,
    barcode_value: barcodeValue,
    field_values: values,
    print_svg: printFile.svg,
    ship_to: shipTo as unknown as Record<string, string>,
    unit_price_cents: product.price_cents,
    notes: str(formData, "notes") || null,
  });
  if (error) throw error;

  revalidatePath("/store/orders");
  return {};
}

/**
 * Move an order to its next step. When it ships, the team member gets a text
 * with the tracking number (if GoHighLevel is connected).
 */
export async function advanceMerchOrder(
  id: string,
  details: { vendorOrderRef?: string; trackingNumber?: string } = {}
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("merch_orders")
    .select("id, status, team_member_id, product:merch_products(name)")
    .eq("id", id)
    .single();
  if (error) throw error;

  const next = nextStatus(order.status as MerchOrderStatus);
  if (!next) return { error: "This order is already finished." };

  const update: { status: MerchOrderStatus; vendor_order_ref?: string; tracking_number?: string } = {
    status: next,
  };
  if (details.vendorOrderRef?.trim()) update.vendor_order_ref = details.vendorOrderRef.trim();
  if (details.trackingNumber?.trim()) update.tracking_number = details.trackingNumber.trim();

  const { error: updateError } = await supabase
    .from("merch_orders")
    .update(update)
    .eq("id", id)
    .eq("status", order.status);
  if (updateError) throw updateError;

  revalidatePath("/store/orders");

  if (next === "shipped" && isGhlConfigured()) {
    const { data: member } = await supabase
      .from("team_members")
      .select("*")
      .eq("id", order.team_member_id)
      .single();
    if (member) {
      const productName = (order.product as unknown as { name: string } | null)?.name ?? "order";
      const tracking = update.tracking_number ? ` Tracking: ${update.tracking_number}` : "";
      try {
        await sendTextToMember(
          supabase,
          member as unknown as TeamMember,
          `Hey ${(member as unknown as TeamMember).name.split(" ")[0]}, your ${productName} just shipped!${tracking}`,
          null
        );
      } catch (err) {
        console.error("[store] shipped text failed", err);
        return { error: "Marked shipped, but the text to the team member didn't send." };
      }
    }
  }
  return {};
}

export async function cancelMerchOrder(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("merch_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["requested", "approved"]);
  if (error) throw error;
  revalidatePath("/store/orders");
}

export async function setMerchPaymentStatus(id: string, paymentStatus: MerchPaymentStatus) {
  if (!PAYMENT_OPTIONS.some((p) => p.value === paymentStatus)) throw new Error("Unknown payment status");
  const supabase = await createClient();
  const { error } = await supabase.from("merch_orders").update({ payment_status: paymentStatus }).eq("id", id);
  if (error) throw error;
  revalidatePath("/store/orders");
}
