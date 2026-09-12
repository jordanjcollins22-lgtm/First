/**
 * Light, dark, or whatever the phone is already doing.
 *
 * Three settings rather than a switch, because "system" is the honest
 * default: somebody whose phone goes dark at sunset expects the app to
 * follow, and a two-way toggle forces them to come back and flip it twice a
 * day.
 *
 * Pure so the resolution can be tested, and so the same rules can run in a
 * one-line script before the page paints and in React afterwards without
 * drifting apart.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";

/** Where the choice lives between visits. */
export const THEME_KEY = "celerity-theme";

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Anything unreadable is "system", which is the safe answer. */
export function readChoice(stored: string | null | undefined): ThemeChoice {
  return isThemeChoice(stored) ? stored : "system";
}

/** What to actually paint. */
export function applyTheme(choice: ThemeChoice, systemPrefersDark: boolean): AppliedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * What the switch does next.
 *
 * From system it goes to the opposite of what is on screen, so the first tap
 * always visibly changes something. Tapping a switch and seeing nothing
 * happen is how somebody decides it is broken.
 */
export function nextChoice(current: ThemeChoice, systemPrefersDark: boolean): ThemeChoice {
  const showing = applyTheme(current, systemPrefersDark);
  return showing === "dark" ? "light" : "dark";
}

/** The label for the control, saying what it will do rather than what it is. */
export function toggleLabel(current: ThemeChoice, systemPrefersDark: boolean): string {
  return applyTheme(current, systemPrefersDark) === "dark"
    ? "Switch to light mode"
    : "Switch to dark mode";
}

/**
 * The script that runs before anything is drawn.
 *
 * Without it the page paints light, then React loads and repaints dark, and
 * everybody in a dark room gets a white flash in the face. It is written as
 * one string because it has to be inline in the document head; anything
 * fetched is already too late.
 *
 * Wrapped in a try because storage throws outright in a locked-down browser,
 * and a themeing preference is never worth a blank page.
 */
export function themeScript(): string {
  return `(function(){try{var c=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=c==="dark"||((c===null||c==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
}
