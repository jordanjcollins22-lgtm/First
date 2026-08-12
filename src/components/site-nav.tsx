"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { logout } from "@/lib/actions/auth-actions";

const JORDAN_EMAIL = "jordanjcollins22@gmail.com";

const DATABASE_LINKS = [
  { href: "/admin/tools", label: "Tool Database" },
  { href: "/admin/materials", label: "Material Database" },
  { href: "/admin/service-pricing", label: "Services Database" },
  { href: "/admin/team", label: "Team Database" },
];

export function SiteNav({ userEmail }: { userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const links = userEmail === JORDAN_EMAIL ? [...DATABASE_LINKS, { href: "/admin/overhead", label: "Overhead" }] : DATABASE_LINKS;

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
      <Link href="/attractors" className="hover:text-primary">
        Project Data
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
          <div className="absolute right-0 top-full z-10 mt-2 w-56 rounded-xl border border-white/60 bg-card/80 py-1 shadow-xl backdrop-blur-xl backdrop-saturate-150">
            {links.map((link) => (
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

      {userEmail && (
        <form action={logout} className="flex items-center gap-2 border-l border-border pl-4">
          <span className="hidden text-xs text-muted-foreground sm:inline">{userEmail}</span>
          <button type="submit" className="text-muted-foreground hover:text-primary">
            Sign out
          </button>
        </form>
      )}
    </nav>
  );
}
