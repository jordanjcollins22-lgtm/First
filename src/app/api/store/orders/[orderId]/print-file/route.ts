import { createClient } from "@/lib/supabase/server";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

/** Download the frozen print file for an order, ready to upload to the vendor. */
export async function GET(_request: Request, ctx: RouteContext<"/api/store/orders/[orderId]/print-file">) {
  const { orderId } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merch_orders")
    .select("id, print_svg, product:merch_products(name), team_member:team_members(name)")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return new Response("Order not found", { status: 404 });

  const product = (data.product as unknown as { name: string } | null)?.name ?? "item";
  const member = (data.team_member as unknown as { name: string } | null)?.name ?? "member";
  const filename = `${slug(product)}-${slug(member)}-${data.id.slice(0, 8)}.svg`;

  return new Response(data.print_svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Uploaded designs are ours, but never let a downloaded SVG run script in our origin.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
