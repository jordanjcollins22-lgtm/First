/**
 * How a change came to us.
 *
 * Most changes to a quote or an evaluation never touch a button in the app.
 * The client reads it on their phone and texts instead, and somebody here
 * makes the change. A record that says only "the office changed it" reads,
 * months later, like we quietly changed something nobody asked us to.
 *
 * Shared by the proposal and the evaluation, because it is the same question
 * both times and two lists of the same four options drift apart.
 */

export type RequestSource = "text" | "call" | "in_person" | "office";

export const REQUEST_SOURCES: { value: RequestSource; label: string }[] = [
  { value: "text", label: "They texted" },
  { value: "call", label: "They called" },
  { value: "in_person", label: "In person" },
  { value: "office", label: "Our call" },
];

export function sourceLabel(source: string | null | undefined): string | null {
  return REQUEST_SOURCES.find((s) => s.value === source)?.label ?? null;
}
