import { Eye, Flame } from "lucide-react";

/**
 * How often the client has opened their proposal. Internal only.
 *
 * Takes a finished label rather than the rows and a clock: the wording is
 * worked out on the server so it is the same on every screen, and so a
 * relative time cannot differ between what the server rendered and what the
 * browser hydrates.
 */
export function ViewCount({
  label,
  warm = false,
  className = "",
}: {
  label: string;
  /** Opened repeatedly while still unanswered. Worth a phone call. */
  warm?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        warm ? "font-semibold text-amber-700" : "text-muted-foreground"
      } ${className}`}
    >
      {warm ? <Flame className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}
