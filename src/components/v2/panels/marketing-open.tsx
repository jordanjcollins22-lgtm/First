"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { useOpenEntity } from "@/components/v2/entity-drawer";
import type { EntityRef } from "@/lib/entities/types";

/**
 * A button on a Marketing panel that opens a thing in the drawer: a review,
 * a list of plays waiting, a draft campaign. Renders nothing outside the
 * drawer's provider, so a panel still draws anywhere else.
 */
export function OpenInDrawer({ entity, children, className }: { entity: EntityRef; children: ReactNode; className?: string }) {
  const open = useOpenEntity();
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => open(entity)}
      className={className ?? "inline-flex min-h-9 items-center gap-1 rounded-lg border bg-card px-3 text-sm font-semibold hover:bg-muted"}
    >
      {children}
      <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
