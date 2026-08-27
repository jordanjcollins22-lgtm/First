"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { logout } from "@/lib/actions/auth-actions";
import { isFieldOnly } from "@/lib/affiliate-roles";

/**
 * The whole navigation, at both sizes.
 *
 * On a phone the menu is a full-width sheet with thumb-sized rows rather than
 * a 224px dropdown holding seventeen links — the old panel put four-millimetre
 * targets under a thumb and pushed the sign-out control into a header that had
 * no room for it. On a desktop it stays the compact dropdown it was.
 *
 * Everything the matrix governs reads off allowedTabs, so unticking a box on
 * the Permissions page actually removes the link. The exceptions below are the
 * ones it deliberately doesn't cover.
 */
export function SiteNav({
  userEmail,
  roles,
  allowedTabs,
}: {
  userEmail: string | null;
  roles: string[];
  allowedTabs: string[];
}) {
  const fieldOnly = isFieldOnly(roles);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const can = (tab: string) => allowedTabs.includes(tab);

  // Field-only people get one link. The rest of the app is for the office, and
  // a menu of seventeen things they cannot use is worse than no menu.
  const links = fieldOnly
    ? [{ href: "/my-day", label: "My Day" }]
    : [
        ...(can("dashboard") ? [{ href: "/dashboard", label: "Dashboard" }] : []),
        // Never tab-gated: both of these show the signed-in person their own
        // work, so there is nothing a tick would be protecting.
        { href: "/my-day", label: "My Day" },
        // ?new=1 because the root redirects admins to the dashboard, and this
        // is the link that has to get past that.
        ...(can("new-property") ? [{ href: "/?new=1", label: "New Estimate" }] : []),
        ...(can("project-data") ? [{ href: "/attractors", label: "Project Data" }] : []),
        ...(can("pipeline") ? [{ href: "/pipeline", label: "Pipeline" }] : []),
        ...(can("leads") ? [{ href: "/leads", label: "Lead Generation" }] : []),
        ...(can("conversations") ? [{ href: "/conversations", label: "Conversations" }] : []),
        ...(can("evaluations") ? [{ href: "/evaluations", label: "Calendar" }] : []),
        ...(can("knowledge-graph") ? [{ href: "/knowledge-graph", label: "Knowledge Graph" }] : []),
        ...(can("tools") || can("materials") ? [{ href: "/admin/tools", label: "Inventory" }] : []),
        ...(can("services") || can("team") ? [{ href: "/admin/team", label: "Team & Services" }] : []),
        // Overhead folded in here as a tab, so one link covers all of it.
        ...(can("payments") || roles.includes("overhead")
          ? [{ href: "/admin/payments", label: "Money" }]
          : []),
        // Gated on the admin role itself, never on the table it edits —
        // otherwise one stray uncheck would take away the way back in.
        ...(roles.includes("admin")
          ? [
              { href: "/admin/settings", label: "Settings" },
            ]
          : []),
        // Organizations is a tab on Settings now, shown only to the one
        // account that can reach it — so it needs no nav entry of its own.
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

  if (links.length === 0 && !userEmail) return null;

  return (
    <div ref={containerRef} className="relative flex items-center gap-3 text-sm font-medium">
      {/* One shortcut in the bar itself, and only where there's room for it. */}
      {!fieldOnly && can("project-data") && (
        <Link href="/attractors" className="hidden hover:text-primary sm:inline">
          Project Data
        </Link>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg hover:text-primary sm:min-h-9 sm:min-w-0 sm:px-1"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        <span className="hidden sm:inline">Menu</span>
      </button>

      {open && (
        <>
          {/* Dims the page behind the sheet on a phone, so the menu reads as a
              layer rather than as part of the page under it. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-0 -z-10 cursor-default bg-black/20 sm:hidden"
          />

          <div
            className="
              fixed inset-x-2 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto
              rounded-xl border border-white/60 bg-card/95 py-1 shadow-xl backdrop-blur-xl backdrop-saturate-150
              sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[70vh] sm:w-56 sm:bg-card/80
            "
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center px-4 text-base hover:bg-accent hover:text-primary sm:min-h-9 sm:px-3 sm:text-sm"
              >
                {link.label}
              </Link>
            ))}

            {userEmail && (
              <form
                action={logout}
                className="mt-1 flex flex-col gap-1 border-t border-border px-4 pb-2 pt-2 sm:px-3"
              >
                <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                <button
                  type="submit"
                  className="flex min-h-11 items-center text-base text-muted-foreground hover:text-primary sm:min-h-8 sm:text-sm"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
