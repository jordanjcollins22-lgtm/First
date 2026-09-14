"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * The arrow at the top of a page, going back to wherever you came from.
 *
 * It used to be a link to one fixed page, so opening a job from the
 * pipeline, the calendar or My Day and pressing the arrow landed you on
 * Project Data every time. If the last page was one of ours, this goes back
 * to it. If there is no such page, because the link was opened fresh from a
 * text or an email, it goes to the fallback instead of nowhere.
 */
export function BackLink({ fallbackHref, label = "Back" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();

  function back(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const cameFromUs =
      typeof document !== "undefined" &&
      document.referrer.length > 0 &&
      document.referrer.startsWith(window.location.origin) &&
      window.history.length > 1;
    if (cameFromUs) router.back();
    else router.push(fallbackHref);
  }

  return (
    <a
      href={fallbackHref}
      onClick={back}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </a>
  );
}
