"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { setMaterialOnOrder } from "@/lib/actions/material-actions";

interface MaterialOrderStatusProps {
  materialId: string;
  quantityOnHand: number | null;
  reorderThreshold: number | null;
  onOrder: boolean;
}

export function MaterialOrderStatus({
  materialId,
  quantityOnHand,
  reorderThreshold,
  onOrder,
}: MaterialOrderStatusProps) {
  const [isPending, startTransition] = useTransition();

  const isLow =
    quantityOnHand != null && reorderThreshold != null && quantityOnHand <= reorderThreshold;

  function toggle() {
    startTransition(() => setMaterialOnOrder(materialId, !onOrder));
  }

  if (onOrder) {
    return (
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          On order
        </span>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={toggle}>
          It came in
        </Button>
      </div>
    );
  }

  if (isLow) {
    return (
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Time to order
        </span>
        <Button type="button" size="sm" disabled={isPending} onClick={toggle}>
          Order
        </Button>
      </div>
    );
  }

  if (quantityOnHand != null) {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        OK
      </span>
    );
  }

  return <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Not tracked</span>;
}
