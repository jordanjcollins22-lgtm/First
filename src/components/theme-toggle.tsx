"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import {
  applyTheme,
  nextChoice,
  readChoice,
  THEME_KEY,
  toggleLabel,
  type ThemeChoice,
} from "@/lib/theme";

/**
 * The stored choice, as something React can subscribe to.
 *
 * A store rather than state set from an effect: the value already exists
 * before the component mounts, so reading it during render is the honest
 * thing, and useSyncExternalStore is how that is done without the server and
 * the browser disagreeing.
 */
const listeners = new Set<() => void>();

function subscribeChoice(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab flipping the theme should flip this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function choiceSnapshot(): ThemeChoice {
  try {
    return readChoice(localStorage.getItem(THEME_KEY));
  } catch {
    // A browser that refuses storage still gets a working toggle for the
    // length of the visit.
    return "system";
  }
}

/** The server has no idea what the phone prefers, so it says so. */
function serverSnapshot(): ThemeChoice {
  return "system";
}

function setChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not worth failing the tap over.
  }
  for (const listener of listeners) listener();
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(listener: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/**
 * Light and dark, in one tap.
 *
 * Starts on whatever the phone is doing and stays there until somebody says
 * otherwise, so most people never touch it. The first tap always visibly
 * changes something, because tapping a switch and seeing nothing happen is
 * how somebody decides it is broken.
 *
 * The document is already themed by the time this mounts: a one-line script
 * in the layout does it before anything paints. This mirrors that state and
 * writes the changes.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribeChoice, choiceSnapshot, serverSnapshot);
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false
  );

  const applied = applyTheme(choice, systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", applied === "dark");
    document.documentElement.style.colorScheme = applied;
  }, [applied]);

  const label = toggleLabel(choice, systemDark);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setChoice(nextChoice(choice, systemDark))}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground ${className}`}
    >
      {/* Both drawn, one shown, so the icon cannot be wrong for the moment
          between the server's guess and the browser's answer. */}
      <Sun className={`h-4 w-4 ${applied === "dark" ? "" : "hidden"}`} />
      <Moon className={`h-4 w-4 ${applied === "dark" ? "hidden" : ""}`} />
    </button>
  );
}
