"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { setToolOnOrder } from "@/lib/actions/tool-actions";

interface ToolOrderStatusProps {
  toolId: string;
  quantity: number | null;
  reorderThreshold: number | null;
  onOrder: boolean;
  isRental: boolean;
}

export function ToolOrderStatus({ toolId, quantity, reorderThreshold, onOrder, isRental }: ToolOrderStatusProps) {
  const [isPending, startTransition] = useTransition();

  const isLow = quantity != null && reorderThreshold != null && quantity <= reorderThreshold;
  const actionLabel = isRental ? "Rent" : "Buy";
  const activeLabel = isRental ? "On rent" : "On order";

  function toggle() {
    startTransition(() => setToolOnOrder(toolId, !onOrder));
  }

  if (onOrder) {
    return (
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          {activeLabel}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={toggle}>
          It&apos;s here
        </Button>
      </div>
    );
  }

  if (isLow) {
    return (
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Time to {actionLabel.toLowerCase()}
        </span>
        <Button type="button" size="sm" disabled={isPending} onClick={toggle}>
          {actionLabel}
        </Button>
      </div>
    );
  }

  if (quantity != null) {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        OK
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      Not tracked
    </span>
  );
}
