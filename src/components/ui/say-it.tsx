"use client";

import { useSyncExternalStore } from "react";
import { Volume2 } from "lucide-react";

import { canSpeak, speak } from "@/lib/speech";
import { cn } from "@/lib/utils";

/**
 * Hear how a name is said.
 *
 * Half the things on a truck have names nobody is sure how to say out
 * loud: a plant with a Latin name, a tool named after a brand, a seed mix
 * with four words on the bag. Somebody who is not sure does not say it,
 * and a crew member who does not say it does not ask for it, tell a client
 * about it, or write it down. So every one of those names carries a small
 * speaker, and the phone says it.
 *
 * Uses the phone's own voice; nothing is downloaded. Rendered only once the
 * page knows the phone can speak, so a tablet that cannot does not show a
 * button that does nothing.
 */
const never = () => () => {};

export function SayIt({ text, className, label }: { text: string; className?: string; label?: string }) {
  // False on the server and on the first paint, then whatever the phone
  // says, so the markup matches on both sides of hydration.
  const able = useSyncExternalStore(never, canSpeak, () => false);
  if (!able || !text.trim()) return null;

  return (
    <button
      type="button"
      aria-label={`Hear how ${label ?? text} is said`}
      title="Hear how it is said"
      onClick={(event) => {
        // Inside a row that is itself tappable. Saying the name must not
        // also tick it, open it, or select it.
        event.stopPropagation();
        event.preventDefault();
        speak(text);
      }}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <Volume2 className="h-3.5 w-3.5" />
    </button>
  );
}
