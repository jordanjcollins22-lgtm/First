"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { useOpenEntity } from "@/components/v2/entity-drawer";

/**
 * A thing named on an Operations panel (a job, a purchase order, a machine)
 * that opens in the drawer when clicked. Plain words outside the new layout,
 * where there is no drawer to open.
 */
export function OpenEntity({
  kind,
  id,
  children,
  className = "",
  chevron = false,
}: {
  kind: string;
  id: string | null | undefined;
  children: ReactNode;
  className?: string;
  chevron?: boolean;
}) {
  const open = useOpenEntity();
  if (!open || !id) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={() => open({ kind, id })}
      className={`${className} inline-flex items-center gap-1 text-left underline decoration-dotted underline-offset-2 hover:text-primary`}
    >
      {children}
      {chevron && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** A whole row or card that opens: for blocks whose every part names the same thing. */
export function OpenBlock({ kind, id, children, className = "" }: { kind: string; id: string | null | undefined; children: ReactNode; className?: string }) {
  const open = useOpenEntity();
  if (!open || !id) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={() => open({ kind, id })} className={`${className} block w-full rounded-lg text-left hover:bg-primary/10`}>
      {children}
    </button>
  );
}
