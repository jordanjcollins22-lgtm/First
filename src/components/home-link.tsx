"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The name in the header. Inside the new layout it goes to the new layout's first page, never back to the old home. */
export function HomeLink({ children }: { children: React.ReactNode }) {
  const href = usePathname().startsWith("/v2") ? "/v2" : "/";
  return (
    <Link href={href} className="truncate text-base font-bold text-primary sm:text-lg">
      {children}
    </Link>
  );
}
