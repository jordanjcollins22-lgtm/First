/**
 * The little circle with somebody's initials in it.
 *
 * Every list of people in the app used to be a wall of identical text rows.
 * A coloured disc with two letters is what lets somebody find the row they
 * want by shape rather than by reading, which is most of how a phone screen
 * is actually used.
 *
 * The colour comes from the name, so the same person is the same colour on
 * every screen, forever, without a colour ever being stored.
 */

/** Two letters, from the first and last word of a name. */
export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";

  // A row whose name is a phone number is a real row: somebody texted in and
  // nobody has put a name to them yet. Initials mean nothing there, so it
  // takes the first two digits, which is at least something to recognise the
  // row by next time.
  if (!/[A-Za-z]/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.slice(0, 2) || "?";
  }

  const words = trimmed.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return "?";

  const letterIn = (word: string) => word.replace(/[^A-Za-z]/g, "")[0] ?? "";
  const first = letterIn(words[0]);
  const last = words.length > 1 ? letterIn(words[words.length - 1]) : "";

  return `${first}${last}`.toUpperCase() || "?";
}

/**
 * Discs, in the app's own greens and a few neighbours.
 *
 * Deliberately muted: a list of thirty of these should read as a list, not
 * as a bag of sweets. Each one carries its own text colour, because a mid
 * green and a pale green need opposite text and picking one for both makes
 * half of them unreadable.
 */
const DISCS: { bg: string; text: string }[] = [
  { bg: "#2f6d3c", text: "#ffffff" },
  { bg: "#3a8d7a", text: "#ffffff" },
  { bg: "#4a6fa5", text: "#ffffff" },
  { bg: "#7a5ea8", text: "#ffffff" },
  { bg: "#a8654a", text: "#ffffff" },
  { bg: "#8a8f3d", text: "#ffffff" },
  { bg: "#c08a2e", text: "#1a1200" },
  { bg: "#4f7d8c", text: "#ffffff" },
];

/**
 * A stable number from a name.
 *
 * Any hash would do as long as it never changes: somebody whose disc turns
 * a different colour after a rename has, as far as the eye is concerned,
 * become a different person.
 */
function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total = (total * 31 + value.charCodeAt(i)) % 100000;
  }
  return total;
}

export function discFor(name: string): { bg: string; text: string } {
  const key = name.trim().toLowerCase();
  if (!key) return DISCS[0];
  return DISCS[hash(key) % DISCS.length];
}

/** How long ago, the way a list shows it: a time today, a date before that. */
export function listDate(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  if (sameDay) {
    return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return at.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

/** One line of a message, flattened and cut to fit a row. */
export function previewOf(body: string, limit = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}
