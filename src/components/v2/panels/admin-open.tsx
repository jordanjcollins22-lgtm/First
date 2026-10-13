"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { useOpenEntity } from "@/components/v2/entity-drawer";

/**
 * The Admin panels' way into the drawer. A server-rendered panel puts one of
 * these where it names a thing; tapping it opens that thing with its details
 * and actions. Outside the drawer's provider it is plain words.
 */

export function OpenEntity({ kind, id, children, className = "" }: { kind: string; id: string; children: ReactNode; className?: string }) {
  const open = useOpenEntity();
  if (!open || !id) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={() => open({ kind, id })} className={`text-left underline-offset-4 hover:underline ${className}`}>
      {children}
    </button>
  );
}

export function OpenButton({ kind, id, label = "Open" }: { kind: string; id: string; label?: string }) {
  const open = useOpenEntity();
  if (!open || !id) return null;
  return (
    <button
      type="button"
      onClick={() => open({ kind, id })}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-3 text-sm font-semibold hover:bg-muted"
    >
      {label}
      <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
