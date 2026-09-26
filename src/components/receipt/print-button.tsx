"use client";

import { Printer } from "lucide-react";

/**
 * The download button, honestly named.
 *
 * There is no PDF library behind this and there does not need to be one:
 * every phone and browser turns a printed page into a PDF, and a receipt is
 * a page. The button says "Save or print" because that is what happens.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
    >
      <Printer className="h-4 w-4" />
      Save or print
    </button>
  );
}
