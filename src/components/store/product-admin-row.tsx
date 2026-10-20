"use client";

import { useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setMerchProductActive } from "@/lib/actions/merch-actions";
import { formatCents } from "@/lib/merch/format";
import type { MerchProduct } from "@/types/domain";

export function ProductAdminRow({ product }: { product: MerchProduct }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <div>
        <p className="font-medium">
          {product.name} · {formatCents(product.price_cents)}
        </p>
        <p className="text-muted-foreground">
          {[product.vendor_name, product.vendor_sku, product.print_specs].filter(Boolean).join(" · ") ||
            "No vendor details yet"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!product.active && <Badge variant="outline">Hidden</Badge>}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => startTransition(() => setMerchProductActive(product.id, !product.active))}
        >
          {product.active ? "Hide" : "Show in store"}
        </Button>
      </div>
    </div>
  );
}
