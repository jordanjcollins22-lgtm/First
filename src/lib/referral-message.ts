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

/**
 * Laid out like a text from a person: the greeting on its own line, a blank
 * line between parts, and their link on a line of its own so it stays tappable.
 */
export function referralMessage(input: { name: string; affiliation: Affiliation; link: string; business: string; from: string | null }): string {
  const them = firstNameOf(input.name);
  const me = input.from ? firstNameOf(input.from) : null;
  const hi = input.affiliation === "online" ? `Hi ${them || "there"}!` : them ? `Hey ${them}!` : "Hey!";
  const crew = `${input.business}, a local landscaping crew in Harford County`;
  let intro: string;
  switch (input.affiliation) {
    case "neighbor":
      intro = `It's ${me ?? "your neighbor"} from down the street. I work with ${input.business}, a local crew here in Harford County.`;
      break;
    case "friend":
      intro = `I've been working with ${crew}.`;
      break;
    case "family":
      intro = `You know I've been working with ${input.business}.`;
      break;
    case "coworker":
      intro = `It's ${me ?? "me"} from work. I also work with ${crew}.`;
      break;
    case "online":
      intro = `I saw you were looking for yard help. I work with ${input.business}, a local crew here in Harford County.`;
      break;
    default:
      intro = me ? `It's ${me}. I work with ${crew}.` : `I work with ${crew}.`;
  }
  return [hi, intro, `If you ever need help with your yard, here's my link to get an estimate set up:\n${input.link}`, "They'll reach out to you from there. Thanks!"].join("\n\n");
}
