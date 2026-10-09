/**
 * "How did you hear about us?", asked on every booking.
 *
 * Most evaluations booked before this had no source at all, so nobody could
 * say which marketing was paying for itself. Shared between the public
 * booking page, the office's phone booking, and the server actions that
 * check them, so the list is the same everywhere. Pure, so it is tested
 * without a browser.
 */
export const HEARD_ABOUT_OPTIONS = [
  "Google search",
  "Google Maps or reviews",
  "Facebook",
  "Nextdoor",
  "Instagram",
  "Friend, family or neighbor",
  "We've worked for you before",
  "Saw your truck or a yard sign",
  "Door hanger or flyer",
  "Postcard in the mail",
  "Other",
] as const;

export type HeardAbout = (typeof HEARD_ABOUT_OPTIONS)[number];

/**
 * The answer as it is stored: one of the options, or "Other: <what they
 * typed>". Null when it is missing or not one of ours, so the caller refuses
 * the booking rather than recording something nobody can count.
 */
export function heardAboutAnswer(choice: string | null | undefined, other?: string | null): string | null {
  const picked = HEARD_ABOUT_OPTIONS.find((o) => o === choice?.trim());
  if (!picked) return null;
  if (picked !== "Other") return picked;
  const said = (other ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return said ? `Other: ${said}` : null;
}

/** What to tell somebody who left it blank. */
export function heardAboutProblem(choice: string | null | undefined, other?: string | null): string | null {
  if (!choice?.trim()) return "Tell us how you heard about us.";
  if (heardAboutAnswer(choice, other)) return null;
  return choice.trim() === "Other" ? "Tell us where you heard about us." : "Pick how you heard about us.";
}
