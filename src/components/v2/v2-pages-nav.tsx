"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * The four pages of the new layout. Lives in the layout rather than the page,
 * so it stays on screen and lights up the moment it is tapped: the pages read
 * a lot of live numbers before they show, and a bar that sat there unchanged
 * for those seconds looked like it couldn't be clicked.
 */
const PAGES = [
  { key: "marketing", label: "Marketing" },
  { key: "sales", label: "Sales" },
  { key: "operations", label: "Operations" },
  { key: "admin", label: "Admin" },
] as const;

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null;
}

export function V2PagesNav({ pages }: { pages: readonly string[] }) {
  const pathname = usePathname();
  const current = pathname.split("/")[2] ?? "marketing";
  return (
    <nav aria-label="New app pages" className="flex flex-wrap gap-1 rounded-xl border bg-card/80 p-2 shadow-sm">
      {PAGES.filter((p) => pages.includes(p.key)).map((p) => (
        <Link
          key={p.key}
          href={`/v2/${p.key}`}
          aria-current={p.key === current ? "page" : undefined}
          className={
            "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold " +
            (p.key === current ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")
          }
        >
          {p.label}
          <Pending />
        </Link>
      ))}
    </nav>
  );
}
