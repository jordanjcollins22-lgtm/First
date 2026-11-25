"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The bar on top of a single app opened from the home screen: back to the
 * home screen. A drop-down part opens by itself, since it's the only thing
 * on the screen.
 */
export function OnlyApp({ id, home }: { id: string; home: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
  }, [id]);
  return (
    <div className="mx-auto w-full max-w-[440px] px-3 pt-3">
      <Link href={home} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
        ‹ Home
      </Link>
    </div>
  );
}
