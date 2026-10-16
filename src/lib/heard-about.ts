/**
 * "How did you hear about us?": asked when somebody books, online or on the
 * phone, and kept on the job, so Marketing can count which channel actually
 * brings in visits and, later, signed work.
 *
 * A short fixed list, so the answers add up; "Other" carries a few words.
 */
export const HEARD_ABOUT = [
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "nextdoor", label: "Nextdoor" },
  { value: "friend", label: "Friend or neighbor" },
  { value: "yard_sign", label: "Yard sign" },
  { value: "door_hanger", label: "Door hanger or flyer" },
  { value: "truck", label: "Saw our truck or crew" },
  { value: "returning", label: "Worked with you before" },
  { value: "other", label: "Other" },
] as const;

export type HeardAbout = (typeof HEARD_ABOUT)[number]["value"];

export const HEARD_ABOUT_LABEL: Record<string, string> = Object.fromEntries(HEARD_ABOUT.map((o) => [o.value, o.label]));

/** An answer from a form, checked: one of the list or nothing, and "Other"'s words trimmed. */
export function cleanHeardAbout(value: unknown, detail: unknown): { heard_about: HeardAbout | null; heard_about_detail: string | null } {
  const v = typeof value === "string" && HEARD_ABOUT.some((o) => o.value === value) ? (value as HeardAbout) : null;
  const d = v === "other" && typeof detail === "string" ? detail.trim().slice(0, 80) || null : null;
  return { heard_about: v, heard_about_detail: d };
}

/** A job counts as signed once the client has said yes to the work. */
const SIGNED = new Set(["approved", "in_progress", "completed"]);

export interface HeardAboutLine {
  value: HeardAbout | "none";
  label: string;
  booked: number;
  signed: number;
}

/**
 * Visits booked and work signed, per answer, most visits first. Jobs whose
 * client wasn't asked (or skipped it) are one line at the end, so the gap in
 * what's known shows rather than hides.
 */
export function heardAboutSummary(jobs: { heard_about: string | null; status: string | null }[]): HeardAboutLine[] {
  const by = new Map<string, HeardAboutLine>();
  for (const j of jobs) {
    const known = HEARD_ABOUT.find((o) => o.value === j.heard_about);
    const key = known?.value ?? "none";
    const line = by.get(key) ?? { value: key, label: known?.label ?? "Not asked", booked: 0, signed: 0 };
    line.booked += 1;
    if (j.status && SIGNED.has(j.status)) line.signed += 1;
    by.set(key, line);
  }
  const lines = [...by.values()];
  return [...lines.filter((l) => l.value !== "none").sort((a, b) => b.booked - a.booked || b.signed - a.signed), ...lines.filter((l) => l.value === "none")];
}
