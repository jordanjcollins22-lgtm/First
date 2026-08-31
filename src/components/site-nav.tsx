"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { logout } from "@/lib/actions/auth-actions";
import { isFieldOnly } from "@/lib/affiliate-roles";
import { moreTabs, primaryNav } from "@/lib/nav-groups";
import { ThemeToggle } from "@/components/theme-toggle";

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
  //
  // Everybody else gets the eight, in a fixed order, and one door to the rest.
  // A nav of seventeen equals is a list people scan for the two things they
  // use; naming the work of the business directly and putting the tools behind
  // More is the same pages, arranged so the daily ones are the ones you see.
  const links = fieldOnly
    ? [{ href: "/my-day", label: "My Day" }]
    : [
        // Never tab-gated: this shows the signed-in person their own work, so
        // there is nothing a tick would be protecting.
        { href: "/my-day", label: "My Day" },
        ...primaryNav(allowedTabs).map((entry) => ({ href: entry.href, label: entry.label })),
        // Gated on the admin role itself, never on the table it edits —
        // otherwise one stray uncheck would take away the way back in.
        ...(roles.includes("admin") ? [{ href: "/admin/settings", label: "Settings" }] : []),
        // The drawer. Only shown when there is something in it, because an
        // empty More is a promise of more that is not there.
        ...(moreTabs(allowedTabs).length > 0 ? [{ href: "/more", label: "More" }] : []),
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
      {/* One shortcut in the bar itself, and only where there's room for it.
          The pipeline rather than a tool: it is the screen the office lives on. */}
      {!fieldOnly && can("pipeline") && (
        <Link href="/pipeline" className="hidden hover:text-primary sm:inline">
          Pipeline
        </Link>
      )}

      {/* Beside the menu rather than buried in it: it is a one-tap thing
          somebody does when the light in the room changes, not a setting. */}
      <ThemeToggle />

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
