/**
 * The message an affiliate sends someone they know, with their own tracked
 * link in it. Written to sound like a person, fitting how they know them,
 * and true: it promises an estimate gets set up, never that it's free.
 */

export const AFFILIATIONS = [
  { key: "neighbor", label: "Neighbor" },
  { key: "friend", label: "Friend" },
  { key: "family", label: "Family" },
  { key: "coworker", label: "Coworker" },
  { key: "online", label: "Someone online" },
  { key: "other", label: "Other" },
] as const;

export type Affiliation = (typeof AFFILIATIONS)[number]["key"];

export function isAffiliation(value: string): value is Affiliation {
  return AFFILIATIONS.some((a) => a.key === value);
}

export function affiliationLabel(key: string | null | undefined): string {
  return AFFILIATIONS.find((a) => a.key === key || a.label === key)?.label ?? "Other";
}

/** Their first name, tidied: what goes after "Hey". */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : "";
}

export function referralMessage(input: { name: string; affiliation: Affiliation; link: string; business: string; from: string | null }): string {
  const them = firstNameOf(input.name);
  const hi = them ? `Hey ${them}` : "Hey";
  const me = input.from ? firstNameOf(input.from) : null;
  const ask = `If you ever need help with your yard, here's my link to get an estimate set up: ${input.link}`;
  const after = "They'll reach out to you, and take it from there.";
  switch (input.affiliation) {
    case "neighbor":
      return `${hi}, it's ${me ?? "your neighbor"} from down the street! I work with ${input.business}, a local crew here in Harford County. ${ask}\n\n${after}`;
    case "friend":
      return `${hi}! I've been working with ${input.business}, a local landscaping crew in Harford County. ${ask}\n\n${after}`;
    case "family":
      return `${hi}! You know I've been working with ${input.business}. ${ask}\n\n${after}`;
    case "coworker":
      return `${hi}, it's ${me ?? "me"} from work. I also work with ${input.business}, a local landscaping crew in Harford County. ${ask}\n\n${after}`;
    case "online":
      return `Hi ${them || "there"}, I saw you were looking for yard help. I work with ${input.business}, a local crew in Harford County. ${ask}\n\n${after}`;
    default:
      return `${hi}${me ? `, it's ${me}` : ""}. I work with ${input.business}, a local landscaping crew in Harford County. ${ask}\n\n${after}`;
  }
}
