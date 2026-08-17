"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { logout } from "@/lib/actions/auth-actions";

export function SiteNav({
  userEmail,
  roles,
  allowedTabs,
}: {
  userEmail: string | null;
  roles: string[];
  allowedTabs: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const showProjectData = allowedTabs.includes("project-data");
  const showEvaluations = allowedTabs.includes("evaluations");
  // Project Data is the only tab kept in the bar; everything else lives in
  // the menu so the header stays readable as tabs get added.
  // Everything the matrix governs reads off allowedTabs, so unticking a box on
  // the Permissions page actually removes the link. The two exceptions below
  // are the ones it deliberately doesn't cover.
  const can = (tab: string) => allowedTabs.includes(tab);

  const links = [
    ...(can("pipeline") ? [{ href: "/pipeline", label: "Pipeline" }] : []),
    ...(can("contacts") ? [{ href: "/contacts", label: "Contacts" }] : []),
    ...(can("proposals") ? [{ href: "/proposals", label: "Proposals" }] : []),
    ...(can("conversations") ? [{ href: "/conversations", label: "Conversations" }] : []),
    ...(showEvaluations ? [{ href: "/evaluations", label: "Calendar" }] : []),
    ...(can("weather") ? [{ href: "/weather", label: "Weather" }] : []),
    ...(can("notifications") ? [{ href: "/notifications", label: "Notifications" }] : []),
    ...(can("tools") || can("materials") ? [{ href: "/admin/tools", label: "Inventory" }] : []),
    ...(can("services") || can("team") ? [{ href: "/admin/team", label: "Team & Services" }] : []),
    ...(can("payments") ? [{ href: "/admin/payments", label: "Payments" }] : []),
    ...(can("overhead") || roles.includes("overhead")
      ? [{ href: "/admin/overhead", label: "Overhead" }]
      : []),
    ...(can("gambling") ? [{ href: "/gambling", label: "Gambling (test)" }] : []),
    ...(can("journeys") ? [{ href: "/admin/journeys", label: "Journey Dashboard" }] : []),
    // Gated on the admin role itself, never on the table it edits — otherwise
    // one stray uncheck would take away the way back in.
    ...(roles.includes("admin") ? [{ href: "/admin/permissions", label: "Permissions" }] : []),
    // Superadmin, decided by account rather than by role.
    ...(userEmail?.toLowerCase() === "jordan@jslandscapingmd.com"
      ? [{ href: "/admin/organizations", label: "Organizations" }]
      : []),
  ];

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
      {showProjectData && (
        <Link href="/attractors" className="hover:text-primary">
          Project Data
        </Link>
      )}

      {links.length > 0 && (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 hover:text-primary"
            aria-expanded={open}
          >
            Menu
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
      )}

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
