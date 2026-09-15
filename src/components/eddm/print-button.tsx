"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The one control on a page that exists to be printed. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer className="mr-1.5 h-4 w-4" />
      Print order package
    </Button>
  );
}
