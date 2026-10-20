"use client";

import { useState, useTransition } from "react";
import { Copy, Download, X } from "lucide-react";

import { SELECT_CLASS } from "@/components/team/constants";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  advanceMerchOrder,
  cancelMerchOrder,
  setMerchPaymentStatus,
} from "@/lib/actions/merch-actions";
import type { MerchOrderWithRelations } from "@/lib/data/merch";
import { formatCents, ORDER_STEPS, PAYMENT_OPTIONS } from "@/lib/merch/format";
import type { MerchOrderStatus, MerchPaymentStatus } from "@/types/domain";

const STATUS_VARIANT: Record<MerchOrderStatus, BadgeProps["variant"]> = {
  requested: "outline",
  approved: "secondary",
  sent_to_vendor: "secondary",
  shipped: "default",
  delivered: "default",
  cancelled: "destructive",
};

/** Everything the vendor needs, as plain text to paste into their order form or an email. */
function vendorDetails(order: MerchOrderWithRelations) {
  const s = order.ship_to;
  return [
    `Item: ${order.product?.name ?? "Unknown"}${order.product?.vendor_sku ? ` (SKU ${order.product.vendor_sku})` : ""}`,
    order.product?.print_specs ? `Specs: ${order.product.print_specs}` : null,
    `Quantity: ${order.quantity}`,
    `Print file: attached (order ${order.id.slice(0, 8)})`,
    "",
    "Ship to:",
    s.name,
    s.address1,
    s.address2,
    `${s.city}, ${s.state} ${s.zip}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

export function OrderCard({ order }: { order: MerchOrderWithRelations }) {
  const [vendorRef, setVendorRef] = useState("");
  const [tracking, setTracking] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const step = ORDER_STEPS.find((s) => s.value === order.status);
  const s = order.ship_to;

  function advance() {
    startTransition(async () => {
      const result = await advanceMerchOrder(order.id, { vendorOrderRef: vendorRef, trackingNumber: tracking });
      setNotice(result.error ?? null);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">
              {order.quantity} × {order.product?.name ?? "Unknown item"}
              <span className="font-normal text-muted-foreground"> for {order.team_member?.name ?? "former member"}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Barcode <code>{order.barcode_value}</code> ·{" "}
              {formatCents(order.unit_price_cents * order.quantity)} ·{" "}
              {new Date(order.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={STATUS_VARIANT[order.status]}>{step?.label}</Badge>
              {order.product?.vendor_name && <Badge variant="outline">Vendor: {order.product.vendor_name}</Badge>}
              {order.vendor_order_ref && <Badge variant="outline">Vendor order {order.vendor_order_ref}</Badge>}
              {order.tracking_number && <Badge variant="outline">Tracking {order.tracking_number}</Badge>}
            </div>
          </div>
          <div className="flex gap-1">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/store/orders/${order.id}/print-file`} download>
                <Download className="mr-1.5 h-4 w-4" />
                Print file
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Copy details for the vendor"
              onClick={async () => {
                await navigator.clipboard.writeText(vendorDetails(order));
                setNotice("Vendor details copied.");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <p className="font-medium">Ship to</p>
            <p className="text-muted-foreground">
              {s.name}
              <br />
              {s.address1}
              {s.address2 && (
                <>
                  <br />
                  {s.address2}
                </>
              )}
              <br />
              {s.city}, {s.state} {s.zip}
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2">
            {Object.entries(order.field_values).filter(([, v]) => v).length > 0 && (
              <p className="text-muted-foreground">
                {Object.entries(order.field_values)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            )}
            {order.notes && <p className="text-muted-foreground">&ldquo;{order.notes}&rdquo;</p>}
            <label className="flex items-center gap-2">
              <span className="font-medium">Payment</span>
              <select
                className={`${SELECT_CLASS} h-9 py-1 text-sm`}
                value={order.payment_status}
                disabled={isPending}
                onChange={(e) =>
                  startTransition(() => setMerchPaymentStatus(order.id, e.target.value as MerchPaymentStatus))
                }
              >
                {PAYMENT_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {step?.next && (
          <div className="flex flex-wrap items-center gap-2">
            {order.status === "approved" && (
              <Input
                className="h-9 w-48"
                placeholder="Vendor order # (optional)"
                value={vendorRef}
                onChange={(e) => setVendorRef(e.target.value)}
              />
            )}
            {order.status === "sent_to_vendor" && (
              <Input
                className="h-9 w-48"
                placeholder="Tracking # (optional)"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
            )}
            <Button type="button" size="sm" disabled={isPending} onClick={advance}>
              {isPending ? "Saving..." : step.next}
            </Button>
            {(order.status === "requested" || order.status === "approved") && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  if (confirm("Cancel this order?")) startTransition(() => cancelMerchOrder(order.id));
                }}
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        )}

        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      </CardContent>
    </Card>
  );
}
