"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

const DATABASE_LINKS = [
  { href: "/admin/tools", label: "Tool Database" },
  { href: "/admin/materials", label: "Material Database" },
  { href: "/admin/service-pricing", label: "Services Database" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <nav className="flex items-center gap-4 text-sm font-medium">
      <Link href="/properties" className="hover:text-primary">
        Properties
      </Link>

      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 hover:text-primary"
          aria-expanded={open}
        >
          Databases
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-10 mt-2 w-56 rounded-md border border-border bg-card py-1 shadow-md">
            {DATABASE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm hover:bg-accent hover:text-primary"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link href="/canvas" className="hover:text-primary">
        Canvas
      </Link>
    </nav>
  );
}
