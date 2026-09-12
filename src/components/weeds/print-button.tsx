"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Prints whatever the page put in .print-root, which is the sheet and nothing else. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="mr-1.5 h-4 w-4" /> {label}
    </Button>
  );
}
