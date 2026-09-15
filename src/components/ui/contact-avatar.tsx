import type { LucideIcon } from "lucide-react";

import { discFor, initialsFor } from "@/lib/initials";

/**
 * Somebody's disc, with a badge for how they got in touch.
 *
 * The badge sits on the corner rather than beside the name because a list is
 * scanned down the left edge: whether something is a text, an email or a
 * missed call is answered before any of the words are read.
 */
export function ContactAvatar({
  name,
  badge: Badge,
  badgeClass = "bg-primary text-primary-foreground",
  size = "md",
}: {
  name: string;
  badge?: LucideIcon;
  /** Colour of the little corner badge, so a missed call can read red. */
  badgeClass?: string;
  size?: "sm" | "md" | "lg";
}) {
  const disc = discFor(name);
  const box = size === "lg" ? "h-14 w-14 text-lg" : size === "sm" ? "h-8 w-8 text-[11px]" : "h-11 w-11 text-sm";

  return (
    <span className="relative shrink-0">
      <span
        className={`flex items-center justify-center rounded-full font-semibold ${box}`}
        style={{ backgroundColor: disc.bg, color: disc.text }}
        aria-hidden
      >
        {initialsFor(name)}
      </span>
      {Badge && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-background ${badgeClass}`}
          aria-hidden
        >
          <Badge className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}
