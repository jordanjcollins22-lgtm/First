/**
 * The message an affiliate sends someone they know, with their own tracked
 * link in it. Written to sound like a person, fitting how they know them,
 * and true: it points them to the instant estimate, never promising it's free.
 */

export const AFFILIATIONS = [
  { key: "neighbor", label: "Neighbor" },
  { key: "friend", label: "Friend" },
  { key: "family", label: "Family" },
  { key: "coworker", label: "Coworker" },
  { key: "online_message", label: "Messaged me online" },
  { key: "online_post", label: "Posted asking for help" },
  { key: "other", label: "Other" },
] as const;

export type Affiliation = (typeof AFFILIATIONS)[number]["key"];

/** Older choices that are no longer offered but are still on sent rows. "Someone online" meant a post. */
const RETIRED: Record<string, Affiliation> = { online: "online_post", "Someone online": "online_post" };

export function isAffiliation(value: string): value is Affiliation {
  return AFFILIATIONS.some((a) => a.key === value);
}

/** The choice a sent row was made with, from its saved key or label. */
export function affiliationOf(value: string | null | undefined): Affiliation {
  if (!value) return "other";
  return AFFILIATIONS.find((a) => a.key === value || a.label === value)?.key ?? RETIRED[value] ?? "other";
}

export function affiliationLabel(key: string | null | undefined): string {
  const found = AFFILIATIONS.find((a) => a.key === key || a.label === key);
  if (found) return found.label;
  return key === "Someone online" || key === "online" ? "Someone online" : "Other";
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
  const online = input.affiliation === "online_message" || input.affiliation === "online_post";
  const hi = online ? `Hi ${them || "there"}!` : them ? `Hey ${them}!` : "Hey!";
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
    case "online_message":
      intro = `Thanks for reaching out! I work with ${input.business}, a local crew here in Harford County.`;
      break;
    case "online_post":
      intro = `I saw your post asking for help with your yard. I work with ${input.business}, a local crew here in Harford County.`;
      break;
    default:
      intro = me ? `It's ${me}. I work with ${crew}.` : `I work with ${crew}.`;
  }
  const ask = online
    ? `You can get an instant estimate here, and we'll reach out to set up the rest:\n${input.link}`
    : `If you ever need help with your yard, you can get an instant estimate here:\n${input.link}`;
  return [hi, intro, ask, "Thanks!"].join("\n\n");
}
