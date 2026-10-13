"use client";

import { ChevronRight } from "lucide-react";

import { useOpenEntity } from "@/components/v2/entity-drawer";
import type { EntityRef } from "@/lib/entities/types";

/**
 * Opens a job, client, evaluator or held email in the drawer, from inside a
 * server-rendered Sales panel. Plain words when there is no drawer to open
 * (the panel shown outside the new layout).
 */
export function OpenEntityButton({ entity, label = "Open", className }: { entity: EntityRef; label?: string; className?: string }) {
  const open = useOpenEntity();
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => open(entity)}
      className={
        className ??
        "inline-flex min-h-11 w-fit items-center gap-1 rounded-lg border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
      }
    >
      {label}
      <ChevronRight aria-hidden className="h-4 w-4" />
    </button>
  );
}

/** A name that opens its thing: a heading-sized button, or the bare name without a drawer. */
export function OpenEntityName({ entity, name, className }: { entity: EntityRef; name: string; className?: string }) {
  const open = useOpenEntity();
  if (!open) return <span className={className}>{name}</span>;
  return (
    <button type="button" onClick={() => open(entity)} className={`${className ?? ""} inline-flex items-center gap-1 text-left underline-offset-4 hover:underline`}>
      {name}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 opacity-60" />
    </button>
  );
}
