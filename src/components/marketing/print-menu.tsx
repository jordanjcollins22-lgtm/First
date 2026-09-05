"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

interface Destination {
  href: string;
  label: string;
  description: string;
}

/**
 * One control instead of a growing row of them.
 *
 * Every printed or posted thing gets a screen, and every screen was getting a
 * button at the top of Inventory. Four was already too many and the list only
 * goes one way, so they live behind one press now.
 */
const DESTINATIONS: readonly Destination[] = [
  {
    href: "/admin/flyer",
    label: "Flyer design",
    description: "The EDDM flyer and the seven ad squares on it.",
  },
  {
    href: "/admin/door-hangers",
    label: "Door hangers",
    description: "Two to a sheet, knob hole drawn on.",
  },
  {
    href: "/admin/social",
    label: "Before & after posts",
    description: "Made from the photos crews already take.",
  },
  {
    href: "/admin/labels",
    label: "Labels & codes",
    description: "QR stickers for stock, and the print sheet.",
  },
];

export function PrintMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleAway(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleAway);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleAway);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        Print &amp; marketing
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-white/60 bg-card/95 shadow-xl backdrop-blur-xl sm:left-auto sm:right-0"
        >
          {DESTINATIONS.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-left hover:bg-accent"
            >
              <span className="block text-sm font-medium">{destination.label}</span>
              <span className="block text-xs text-muted-foreground">
                {destination.description}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
